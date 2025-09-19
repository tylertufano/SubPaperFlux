from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable, Optional

from sqlmodel import select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import get_session  # noqa: E402
from app.models import Organization, OrganizationMembership, User  # noqa: E402


def create_user(
    *,
    user_id: str,
    email: Optional[str] = None,
    full_name: Optional[str] = None,
    is_active: bool = True,
) -> User:
    """Create or update a user record for tests."""

    with next(get_session()) as session:
        user = session.get(User, user_id)
        if user is None:
            user = User(
                id=user_id,
                email=email,
                full_name=full_name,
                is_active=is_active,
            )
        else:
            user.email = email
            user.full_name = full_name
            user.is_active = is_active
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


def create_organization(
    *,
    slug: str,
    name: str,
    description: Optional[str] = None,
    is_default: bool = False,
    member_ids: Optional[Iterable[str]] = None,
) -> Organization:
    """Create an organization and optional memberships for tests."""

    with next(get_session()) as session:
        organization = Organization(
            slug=slug,
            name=name,
            description=description,
            is_default=is_default,
        )
        session.add(organization)
        session.commit()
        session.refresh(organization)

        if member_ids:
            for member_id in member_ids:
                existing = session.exec(
                    select(OrganizationMembership).where(
                        OrganizationMembership.organization_id == organization.id,
                        OrganizationMembership.user_id == member_id,
                    )
                ).first()
                if existing:
                    continue
                session.add(
                    OrganizationMembership(
                        organization_id=organization.id,
                        user_id=member_id,
                    )
                )
            session.commit()
            session.refresh(organization)

        return organization
