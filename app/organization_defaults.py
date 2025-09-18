"""Helpers for ensuring the default organization and memberships exist."""
from __future__ import annotations

from typing import Optional

from sqlmodel import select

from .models import Organization, OrganizationMembership

DEFAULT_ORGANIZATION_ID = "org_3c05302ebebe"
DEFAULT_ORGANIZATION_SLUG = "default"
DEFAULT_ORGANIZATION_NAME = "Default Organization"
DEFAULT_ORGANIZATION_DESCRIPTION = "Primary organization for legacy users"


def ensure_default_organization(
    session,
    *,
    organization_id: str = DEFAULT_ORGANIZATION_ID,
    slug: str = DEFAULT_ORGANIZATION_SLUG,
    name: str = DEFAULT_ORGANIZATION_NAME,
    description: str = DEFAULT_ORGANIZATION_DESCRIPTION,
) -> Organization:
    """Ensure the default organization record exists and is marked as default."""

    organization = session.exec(
        select(Organization).where(Organization.slug == slug)
    ).first()
    if organization is None:
        organization = session.exec(
            select(Organization).where(Organization.id == organization_id)
        ).first()

    if organization is None:
        organization = Organization(
            id=organization_id,
            slug=slug,
            name=name,
            description=description,
            is_default=True,
        )
        session.add(organization)
        return organization

    updated = False
    if organization.slug != slug:
        organization.slug = slug
        updated = True
    if organization.name != name:
        organization.name = name
        updated = True
    if organization.description != description:
        organization.description = description
        updated = True
    if not organization.is_default:
        organization.is_default = True
        updated = True
    if updated:
        session.add(organization)
    return organization


def ensure_organization_membership(
    session,
    *,
    organization_id: str,
    user_id: str,
) -> Optional[OrganizationMembership]:
    """Ensure a user is linked to an organization via membership."""

    if not user_id:
        return None

    membership = session.exec(
        select(OrganizationMembership).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.user_id == user_id,
        )
    ).first()

    if membership is None:
        membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=user_id,
        )
        session.add(membership)

    return membership


def ensure_default_organization_membership(
    session,
    *,
    user_id: str,
) -> Optional[OrganizationMembership]:
    """Ensure the provided user belongs to the default organization."""

    organization = ensure_default_organization(session)
    return ensure_organization_membership(
        session,
        organization_id=organization.id,
        user_id=user_id,
    )
