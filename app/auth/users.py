"""Helpers for syncing application ``User`` models from identity claims."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Tuple

from sqlmodel import Session

from ..models import User
from .role_overrides import merge_claims_with_overrides


def _get_identity_mapping(identity: Any) -> Mapping[str, Any]:
    if isinstance(identity, Mapping):
        return identity
    raise ValueError("Identity payload must be a mapping with OIDC claims")


def _claims_dict(identity: Mapping[str, Any]) -> dict[str, Any]:
    claims = identity.get("claims")
    if isinstance(claims, Mapping):
        return dict(claims)
    return {}


def ensure_user_from_identity(
    session: Session,
    identity: Any,
    *,
    update_last_login: bool = False,
) -> Tuple[User, bool, bool]:
    """Create or update a :class:`User` from OIDC identity claims."""

    data = _get_identity_mapping(identity)
    user_id = data.get("sub")
    if not user_id:
        raise ValueError("Missing required 'sub' claim for user identifier")

    now = datetime.now(timezone.utc)
    email = data.get("email")
    full_name = data.get("name")
    picture = data.get("picture") or data.get("picture_url")
    claims = _claims_dict(data)

    created = False
    updated = False

    user = session.get(User, user_id)
    if user:
        if email and user.email != email:
            user.email = email
            updated = True
        if full_name and user.full_name != full_name:
            user.full_name = full_name
            updated = True
        if picture and user.picture_url != picture:
            user.picture_url = picture
            updated = True
        if claims:
            merged_claims = merge_claims_with_overrides(claims, user.claims)
            if user.claims != merged_claims:
                user.claims = merged_claims
                updated = True
        if update_last_login:
            user.last_login_at = now
            updated = True
        if updated:
            user.updated_at = now
            session.add(user)
    else:
        user = User(
            id=str(user_id),
            email=str(email) if email else None,
            full_name=str(full_name) if full_name else None,
            picture_url=str(picture) if picture else None,
            claims=claims,
        )
        if update_last_login:
            user.last_login_at = now
        session.add(user)
        created = True

    return user, created, updated

