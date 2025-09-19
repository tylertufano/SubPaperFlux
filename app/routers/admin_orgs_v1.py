"""Versioned administrative organization management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from sqlalchemy import func, or_
from sqlmodel import Session, select

from ..audit import (
    record_organization_audit_log,
    record_organization_membership_audit_log,
)
from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import Organization, OrganizationMembership, User
from ..observability.metrics import increment_organization_mutation
from ..schemas import (
    AdminOrganization,
    AdminOrganizationCreate,
    AdminOrganizationDetail,
    AdminOrganizationMember,
    AdminOrganizationMembershipChange,
    AdminOrganizationUpdate,
    AdminOrganizationsPage,
)
from .admin import _record_admin_action_metric, _require_admin


router = APIRouter(prefix="/v1/admin/orgs", tags=["v1", "admin"])


def _normalize_slug(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def _normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _serialize_organization(organization: Organization, member_count: int) -> AdminOrganization:
    return AdminOrganization(
        id=organization.id,
        slug=organization.slug,
        name=organization.name,
        description=organization.description,
        is_default=organization.is_default,
        created_at=organization.created_at,
        updated_at=organization.updated_at,
        member_count=member_count,
    )


def _load_members(session: Session, organization_id: str) -> List[AdminOrganizationMember]:
    stmt = (
        select(OrganizationMembership, User)
        .join(User, User.id == OrganizationMembership.user_id, isouter=True)
        .where(OrganizationMembership.organization_id == organization_id)
        .order_by(OrganizationMembership.created_at.asc())
    )
    rows = session.exec(stmt).all()
    members: List[AdminOrganizationMember] = []
    for membership, user in rows:
        if user is None:
            # Membership without a corresponding user record; skip serialization.
            continue
        members.append(
            AdminOrganizationMember(
                id=user.id,
                email=user.email,
                full_name=user.full_name,
                is_active=user.is_active,
                joined_at=membership.created_at,
            )
        )
    return members


def _serialize_organization_detail(
    session: Session,
    organization: Organization,
    *,
    member_count: Optional[int] = None,
) -> AdminOrganizationDetail:
    members = _load_members(session, organization.id)
    computed_count = member_count if member_count is not None else len(members)
    base = _serialize_organization(organization, computed_count)
    return AdminOrganizationDetail(**base.model_dump(), members=members)


def _ensure_unique_slug(
    session: Session, slug: str, *, exclude_id: Optional[str] = None
) -> None:
    stmt = select(Organization).where(Organization.slug == slug)
    if exclude_id:
        stmt = stmt.where(Organization.id != exclude_id)
    existing = session.exec(stmt).first()
    if existing:
        raise HTTPException(status_code=409, detail="Organization slug already exists")


def _ensure_unique_name(
    session: Session, name: str, *, exclude_id: Optional[str] = None
) -> None:
    stmt = select(Organization).where(Organization.name == name)
    if exclude_id:
        stmt = stmt.where(Organization.id != exclude_id)
    existing = session.exec(stmt).first()
    if existing:
        raise HTTPException(status_code=409, detail="Organization name already exists")


def _unset_other_default_organizations(
    session: Session, *, exclude_id: Optional[str] = None
) -> None:
    stmt = select(Organization).where(Organization.is_default.is_(True))
    if exclude_id:
        stmt = stmt.where(Organization.id != exclude_id)
    rows = session.exec(stmt).all()
    if not rows:
        return
    now = datetime.now(timezone.utc)
    for org in rows:
        if not org.is_default:
            continue
        org.is_default = False
        org.updated_at = now
        session.add(org)


@router.get("", response_model=AdminOrganizationsPage, summary="List organizations")
def list_organizations(
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None, description="Filter by slug or name"),
    is_default: Optional[bool] = Query(None, description="Filter by default status"),
):
    _require_admin(session, current_user)

    filters = []
    if search:
        term = f"%{search.lower()}%"
        filters.append(
            or_(
                func.lower(Organization.slug).like(term),
                func.lower(Organization.name).like(term),
            )
        )
    if is_default is not None:
        filters.append(Organization.is_default.is_(is_default))

    stmt = (
        select(
            Organization,
            func.count(OrganizationMembership.user_id).label("member_count"),
        )
        .join(
            OrganizationMembership,
            OrganizationMembership.organization_id == Organization.id,
            isouter=True,
        )
        .group_by(Organization.id)
    )
    count_stmt = select(func.count()).select_from(Organization)

    if filters:
        stmt = stmt.where(*filters)
        count_stmt = count_stmt.where(*filters)

    stmt = stmt.order_by(Organization.created_at.desc())
    offset = (page - 1) * size
    rows = session.exec(stmt.offset(offset).limit(size)).all()
    total = int(session.exec(count_stmt).one() or 0)

    items = [
        _serialize_organization(org, int(member_count or 0))
        for org, member_count in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    result = AdminOrganizationsPage(
        items=items,
        total=total,
        page=page,
        size=size,
        has_next=has_next,
        total_pages=total_pages,
    )
    _record_admin_action_metric("list_organizations")
    return result


@router.get(
    "/{organization_id}",
    response_model=AdminOrganizationDetail,
    summary="Get organization details",
)
def get_organization(
    *,
    organization_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _require_admin(session, current_user)

    organization = session.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = _serialize_organization_detail(session, organization)
    _record_admin_action_metric("get_organization")
    return result


@router.post(
    "",
    response_model=AdminOrganizationDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create an organization",
)
def create_organization(
    *,
    payload: AdminOrganizationCreate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    slug = _normalize_slug(payload.slug)
    name = payload.name.strip()
    description = _normalize_text(payload.description)
    is_default = bool(payload.is_default) if payload.is_default is not None else False

    if not slug:
        raise HTTPException(status_code=400, detail="Organization slug must not be empty")
    if not name:
        raise HTTPException(status_code=400, detail="Organization name must not be empty")

    _ensure_unique_slug(session, slug)
    _ensure_unique_name(session, name)

    organization = Organization(
        slug=slug,
        name=name,
        description=description,
        is_default=is_default,
    )
    session.add(organization)

    if is_default:
        _unset_other_default_organizations(session, exclude_id=organization.id)

    record_organization_audit_log(
        session,
        organization_id=organization.id,
        action="create",
        actor_user_id=actor_id,
        details={
            "slug": organization.slug,
            "name": organization.name,
            "description": organization.description,
            "is_default": organization.is_default,
        },
    )
    session.commit()
    session.refresh(organization)

    increment_organization_mutation("create")
    result = _serialize_organization_detail(session, organization)
    _record_admin_action_metric("create_organization")
    return result


@router.patch(
    "/{organization_id}",
    response_model=AdminOrganizationDetail,
    summary="Update an organization",
)
def update_organization(
    *,
    organization_id: str = Path(..., min_length=1),
    payload: AdminOrganizationUpdate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    organization = session.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    changes: Dict[str, Dict[str, Optional[Any]]] = {}
    now = datetime.now(timezone.utc)

    if payload.slug is not None:
        normalized_slug = _normalize_slug(payload.slug)
        if not normalized_slug:
            raise HTTPException(status_code=400, detail="Organization slug must not be empty")
        if normalized_slug != organization.slug:
            _ensure_unique_slug(
                session, normalized_slug, exclude_id=organization.id
            )
            changes["slug"] = {
                "previous": organization.slug,
                "next": normalized_slug,
            }
            organization.slug = normalized_slug

    if payload.name is not None:
        normalized_name = payload.name.strip()
        if not normalized_name:
            raise HTTPException(status_code=400, detail="Organization name must not be empty")
        if normalized_name != organization.name:
            _ensure_unique_name(
                session, normalized_name, exclude_id=organization.id
            )
            changes["name"] = {
                "previous": organization.name,
                "next": normalized_name,
            }
            organization.name = normalized_name

    if payload.description is not None:
        normalized_description = _normalize_text(payload.description)
        if normalized_description != organization.description:
            changes["description"] = {
                "previous": organization.description,
                "next": normalized_description,
            }
            organization.description = normalized_description

    if payload.is_default is not None and payload.is_default != organization.is_default:
        previous_default = organization.is_default
        organization.is_default = payload.is_default
        changes["is_default"] = {
            "previous": previous_default,
            "next": payload.is_default,
        }
        if payload.is_default:
            _unset_other_default_organizations(session, exclude_id=organization.id)

    if not changes:
        result = _serialize_organization_detail(session, organization)
        _record_admin_action_metric("update_organization")
        return result

    organization.updated_at = now
    session.add(organization)

    record_organization_audit_log(
        session,
        organization_id=organization.id,
        action="update",
        actor_user_id=actor_id,
        details={"changes": changes},
    )
    session.commit()
    session.refresh(organization)

    increment_organization_mutation("update")
    result = _serialize_organization_detail(session, organization)
    _record_admin_action_metric("update_organization")
    return result


@router.delete(
    "/{organization_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an organization",
)
def delete_organization(
    *,
    organization_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    organization = session.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    if organization.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete the default organization")

    record_organization_audit_log(
        session,
        organization_id=organization.id,
        action="delete",
        actor_user_id=actor_id,
        details={
            "slug": organization.slug,
            "name": organization.name,
        },
    )
    session.delete(organization)
    session.commit()

    increment_organization_mutation("delete")
    _record_admin_action_metric("delete_organization")
    return None


@router.post(
    "/{organization_id}/members",
    response_model=AdminOrganizationDetail,
    summary="Add a user to an organization",
)
def add_organization_member(
    *,
    organization_id: str = Path(..., min_length=1),
    payload: AdminOrganizationMembershipChange = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    organization = session.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    user_id = payload.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="User id must not be empty")

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    membership = session.exec(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization.id,
            OrganizationMembership.user_id == user.id,
        )
    ).first()
    if membership:
        result = _serialize_organization_detail(session, organization)
        _record_admin_action_metric("add_organization_member")
        return result

    membership = OrganizationMembership(
        organization_id=organization.id,
        user_id=user.id,
    )
    session.add(membership)
    organization.updated_at = datetime.now(timezone.utc)
    session.add(organization)

    record_organization_membership_audit_log(
        session,
        organization_id=organization.id,
        user_id=user.id,
        action="add_member",
        actor_user_id=actor_id,
        details={"email": user.email},
    )
    record_organization_audit_log(
        session,
        organization_id=organization.id,
        action="member_added",
        actor_user_id=actor_id,
        details={"user_id": user.id},
    )
    session.commit()
    session.refresh(organization)

    increment_organization_mutation("add_member")
    result = _serialize_organization_detail(session, organization)
    _record_admin_action_metric("add_organization_member")
    return result


@router.delete(
    "/{organization_id}/members/{user_id}",
    response_model=AdminOrganizationDetail,
    summary="Remove a user from an organization",
)
def remove_organization_member(
    *,
    organization_id: str = Path(..., min_length=1),
    user_id: str = Path(..., min_length=1),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
):
    actor_id = _require_admin(session, current_user)

    organization = session.get(Organization, organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    membership = session.exec(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization.id,
            OrganizationMembership.user_id == user_id,
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")

    user = membership.user or session.get(User, user_id)
    session.delete(membership)
    organization.updated_at = datetime.now(timezone.utc)
    session.add(organization)

    record_organization_membership_audit_log(
        session,
        organization_id=organization.id,
        user_id=user_id,
        action="remove_member",
        actor_user_id=actor_id,
        details={"email": getattr(user, "email", None)} if user else None,
    )
    record_organization_audit_log(
        session,
        organization_id=organization.id,
        action="member_removed",
        actor_user_id=actor_id,
        details={
            "user_id": user_id,
            "email": getattr(user, "email", None) if user else None,
        },
    )
    session.commit()
    session.refresh(organization)

    increment_organization_mutation("remove_member")
    result = _serialize_organization_detail(session, organization)
    _record_admin_action_metric("remove_organization_member")
    return result
