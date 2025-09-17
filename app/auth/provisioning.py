"""Helpers for provisioning application users during authentication."""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from typing import Any

from sqlmodel import Session

from ..config import is_user_mgmt_core_enabled
from ..db import get_session_ctx
from ..models import User
from . import grant_role
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


def maybe_provision_user(identity: Any) -> None:
    """Ensure a :class:`User` exists for ``identity`` when configured."""

    if not is_user_mgmt_core_enabled():
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
            assigned = False
            if created:
                assigned = _apply_default_role(session, user)

            if created or updated or assigned:
                session.commit()
            else:
                session.rollback()
        except ValueError:
            session.rollback()
            logger.debug("Identity payload missing required fields for provisioning")
        except Exception:  # noqa: BLE001
            session.rollback()
            logger.exception("Failed to auto-provision user from identity claims")

