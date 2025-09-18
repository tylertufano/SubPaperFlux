"""Helpers for provisioning application users during authentication."""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable, Mapping
from typing import Any

from sqlmodel import Session

from ..config import is_user_mgmt_core_enabled
from ..db import get_session_ctx
from ..models import User
from . import get_user_roles, grant_role, revoke_role
from .mapping import resolve_roles_for_groups
from .role_overrides import get_user_role_overrides
from .users import ensure_user_from_identity


logger = logging.getLogger(__name__)


def _is_enabled() -> bool:
    value = os.getenv("OIDC_AUTO_PROVISION_USERS", "0")
    return value.lower() in {"1", "true", "yes", "on"}


def _default_role_name() -> str | None:
    role = os.getenv("OIDC_AUTO_PROVISION_DEFAULT_ROLE")
    if not role:
        return None
    role = role.strip()
    return role or None


def _apply_default_role(session: Session, user: User) -> bool:
    role_name = _default_role_name()
    if not role_name:
        return False
    try:
        grant_role(session, user.id, role_name, create_missing=True)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Failed to assign default role '%s' to user %s", role_name, user.id)
        return False


def _coerce_str_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        candidates = [values]
    elif isinstance(values, Iterable) and not isinstance(values, Mapping):
        candidates = list(values)
    else:
        return []
    result: list[str] = []
    for value in candidates:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            result.append(text)
    return result


def _identity_groups(identity: Mapping[str, Any]) -> list[str]:
    for key in ("groups", "roles"):
        groups = _coerce_str_list(identity.get(key))
        if groups:
            return groups
    claims = identity.get("claims")
    if isinstance(claims, Mapping):
        for key in ("groups", "roles"):
            groups = _coerce_str_list(claims.get(key))
            if groups:
                return groups
    return []


def _normalize_role_set(values: Iterable[str] | None) -> set[str]:
    if not values:
        return set()
    normalized = {str(value).strip() for value in values if value is not None}
    normalized.discard("")
    return normalized


def sync_user_roles_from_identity(
    session: Session,
    user: User,
    identity: Any,
    *,
    extra_desired_roles: Iterable[str] | None = None,
    preserve_roles: Iterable[str] | None = None,
    create_missing_roles: bool = True,
) -> bool:
    """Synchronize ``user`` role assignments from identity claims."""

    if isinstance(identity, Mapping):
        identity_map = identity
    else:
        identity_map = {}

    desired = set(resolve_roles_for_groups(_identity_groups(identity_map)))
    desired.update(_normalize_role_set(extra_desired_roles))

    overrides = get_user_role_overrides(user)
    if overrides.suppress:
        desired.difference_update(overrides.suppress)

    current_roles = set(get_user_roles(session, user.id))
    changed = False

    to_grant = sorted(role for role in desired - current_roles if role)
    for role_name in to_grant:
        grant_role(session, user.id, role_name, create_missing=create_missing_roles)
        changed = True

    protected_roles = _normalize_role_set(preserve_roles)
    if overrides.preserve:
        protected_roles.update(overrides.preserve)

    to_revoke: list[str] = []
    if not overrides.enabled:
        to_revoke_candidates = current_roles - desired
        if protected_roles:
            to_revoke_candidates -= protected_roles
        to_revoke = sorted(role for role in to_revoke_candidates if role)

    for role_name in to_revoke:
        if revoke_role(session, user.id, role_name):
            changed = True

    return changed


def maybe_provision_user(identity: Any, *, user_mgmt_enabled: bool | None = None) -> None:
    """Ensure a :class:`User` exists for ``identity`` when configured."""

    if user_mgmt_enabled is None:
        user_mgmt_enabled = is_user_mgmt_core_enabled()
    if not user_mgmt_enabled:
        return
    if not _is_enabled():
        return
    if not isinstance(identity, Mapping):
        return
    user_id = identity.get("sub")
    if not user_id:
        return

    with get_session_ctx() as session:
        try:
            user, created, updated = ensure_user_from_identity(
                session,
                identity,
                update_last_login=True,
            )
            default_role = _default_role_name()
            roles_changed = sync_user_roles_from_identity(
                session,
                user,
                identity,
                preserve_roles=[default_role] if default_role else None,
            )

            assigned = False
            if created and default_role:
                assigned = _apply_default_role(session, user)

            if created or updated or assigned or roles_changed:
                session.commit()
            else:
                session.rollback()
        except ValueError:
            session.rollback()
            logger.debug("Identity payload missing required fields for provisioning")
        except Exception:  # noqa: BLE001
            session.rollback()
            logger.exception("Failed to auto-provision user from identity claims")

