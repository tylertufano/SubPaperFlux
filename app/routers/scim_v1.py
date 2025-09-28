"""SCIM 2.0 provisioning endpoints."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth.oidc import get_current_user
from ..config import is_scim_write_enabled
from ..db import get_session
from ..models import Organization, OrganizationMembership, User, gen_id
from .admin import _require_admin


router = APIRouter(prefix="/scim/v2", tags=["scim", "v1"])


class SCIMEmail(BaseModel):
    value: str
    primary: Optional[bool] = None


class SCIMUserRequest(BaseModel):
    userName: str
    displayName: Optional[str] = None
    active: Optional[bool] = True
    emails: Optional[List[SCIMEmail]] = None
    externalId: Optional[str] = None


class SCIMGroupMember(BaseModel):
    value: str


class SCIMGroupRequest(BaseModel):
    displayName: str
    members: Optional[List[SCIMGroupMember]] = None
    externalId: Optional[str] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_scim_admin(session: Session, current_user: dict) -> str:
    return _require_admin(session, current_user)


def _require_scim_write_access() -> None:
    if not is_scim_write_enabled():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SCIM writes disabled")


def _resolve_email(payload: SCIMUserRequest) -> str:
    if payload.emails:
        for email in payload.emails:
            if email.primary:
                return email.value
        return payload.emails[0].value
    return payload.userName


def _resolve_display_name(payload: SCIMUserRequest) -> Optional[str]:
    if payload.displayName:
        return payload.displayName
    return None


def _user_to_scim(user: User) -> dict:
    email_entries: List[dict] = []
    if user.email:
        email_entries.append({"value": user.email, "primary": True})
    return {
        "id": user.id,
        "userName": user.email or user.id,
        "displayName": user.full_name,
        "active": user.is_active,
        "emails": email_entries,
        "meta": {
            "resourceType": "User",
            "created": user.created_at.isoformat() if user.created_at else None,
            "lastModified": user.updated_at.isoformat() if user.updated_at else None,
        },
    }


def _group_to_scim(organization: Organization, member_ids: Sequence[str]) -> dict:
    return {
        "id": organization.id,
        "displayName": organization.name,
        "members": [{"value": member_id} for member_id in member_ids],
        "meta": {
            "resourceType": "Group",
            "created": organization.created_at.isoformat() if organization.created_at else None,
            "lastModified": organization.updated_at.isoformat() if organization.updated_at else None,
        },
    }


def _slugify(text: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not normalized:
        normalized = gen_id("grp")
    return normalized


def _sync_memberships(
    session: Session,
    organization_id: str,
    member_ids: Iterable[str],
) -> List[str]:
    desired = {member_id for member_id in member_ids if member_id}
    stmt = select(OrganizationMembership).where(
        OrganizationMembership.organization_id == organization_id
    )
    existing = session.exec(stmt).all()
    existing_ids = {membership.user_id for membership in existing}
    retained: set[str] = set()

    for membership in existing:
        if membership.user_id not in desired:
            session.delete(membership)
        else:
            retained.add(membership.user_id)

    for user_id in desired - existing_ids:
        user = session.get(User, user_id)
        if user is None:
            continue
        session.add(
            OrganizationMembership(
                organization_id=organization_id,
                user_id=user_id,
            )
        )
        retained.add(user_id)

    return sorted(retained)


@router.post("/Users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: SCIMUserRequest,
    *,
    session: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    _require_scim_write_access()
    _require_scim_admin(session, current_user)

    email = _resolve_email(payload)
    display_name = _resolve_display_name(payload)
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")
    user = User(
        id=gen_id("usr"),
        email=email,
        full_name=display_name,
        is_active=payload.active if payload.active is not None else True,
    )
    now = _now()
    user.created_at = now
    user.updated_at = now

    session.add(user)
    session.commit()
    session.refresh(user)

    return _user_to_scim(user)


@router.put("/Users/{user_id}")
def update_user(
    payload: SCIMUserRequest,
    *,
    session: Session = Depends(get_session),
    current_user=Depends(get_current_user),
    user_id: str = Path(..., min_length=1),
):
    _require_scim_write_access()
    _require_scim_admin(session, current_user)

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    email = _resolve_email(payload)
    conflict = session.exec(
        select(User).where(User.email == email, User.id != user.id)
    ).first()
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists")
    user.email = email
    user.full_name = _resolve_display_name(payload)
    if payload.active is not None:
        user.is_active = payload.active
    user.updated_at = _now()

    session.add(user)
    session.commit()
    session.refresh(user)

    return _user_to_scim(user)


@router.delete("/Users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    *,
    session: Session = Depends(get_session),
    current_user=Depends(get_current_user),
    user_id: str = Path(..., min_length=1),
):
    _require_scim_write_access()
    _require_scim_admin(session, current_user)

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    session.delete(user)
    session.commit()
    return None


@router.post("/Groups", status_code=status.HTTP_201_CREATED)
def create_group(
    payload: SCIMGroupRequest,
    *,
    session: Session = Depends(get_session),
    current_user=Depends(get_current_user),
):
    _require_scim_write_access()
    _require_scim_admin(session, current_user)

    if not payload.displayName:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="displayName is required")

    slug = _slugify(payload.displayName)
    existing = session.exec(select(Organization).where(Organization.slug == slug)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Group already exists")

    organization = Organization(
        slug=slug,
        name=payload.displayName,
    )
    now = _now()
    organization.created_at = now
    organization.updated_at = now

    session.add(organization)
    session.commit()
    session.refresh(organization)

    member_ids = _sync_memberships(
        session,
        organization.id,
        [member.value for member in payload.members or []],
    )
    session.commit()

    return _group_to_scim(organization, member_ids)


@router.put("/Groups/{group_id}")
def update_group(
    payload: SCIMGroupRequest,
    *,
    session: Session = Depends(get_session),
    current_user=Depends(get_current_user),
    group_id: str = Path(..., min_length=1),
):
    _require_scim_write_access()
    _require_scim_admin(session, current_user)

    organization = session.get(Organization, group_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    if payload.displayName:
        new_slug = _slugify(payload.displayName)
        conflict = session.exec(
            select(Organization).where(
                Organization.slug == new_slug,
                Organization.id != organization.id,
            )
        ).first()
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Group already exists")
        organization.name = payload.displayName
        organization.slug = new_slug
    organization.updated_at = _now()

    member_ids = _sync_memberships(
        session,
        organization.id,
        [member.value for member in payload.members or []],
    )

    session.add(organization)
    session.commit()
    session.refresh(organization)

    return _group_to_scim(organization, member_ids)


@router.delete("/Groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    *,
    session: Session = Depends(get_session),
    current_user=Depends(get_current_user),
    group_id: str = Path(..., min_length=1),
):
    _require_scim_write_access()
    _require_scim_admin(session, current_user)

    organization = session.get(Organization, group_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    session.delete(organization)
    session.commit()
    return None
