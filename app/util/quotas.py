"""Utilities for enforcing per-user resource quotas."""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.sql import Select
from sqlmodel import Session

from ..models import User


def enforce_user_quota(
    session: Session,
    user_id: str,
    *,
    quota_field: str,
    resource_name: str,
    count_stmt: Select,
    user: Optional[User] = None,
) -> Optional[User]:
    """Ensure ``user_id`` has not exceeded ``quota_field`` for ``resource_name``.

    Parameters
    ----------
    session:
        Active database session.
    user_id:
        Identifier of the user who owns the resource being created.
    quota_field:
        Attribute name on :class:`~app.models.User` storing the quota value.
    resource_name:
        Human-friendly resource label used in error messages.
    count_stmt:
        A ``SELECT`` statement returning the current resource count for ``user_id``.
    user:
        Optional previously-loaded :class:`~app.models.User` instance.

    Raises
    ------
    HTTPException
        Raised with ``403`` when the quota is exceeded, ``404`` when the user does
        not exist, or ``400`` when the identifier is missing.
    """

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User identifier required for quota enforcement",
        )

    user_obj = user or session.get(User, user_id)
    if user_obj is None:
        return None

    quota_value = getattr(user_obj, quota_field, None)
    if quota_value is None:
        return user_obj

    current_total = session.exec(count_stmt).one()
    current = int(current_total or 0)
    if current >= quota_value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{resource_name} quota exceeded (limit {quota_value})",
        )

    return user_obj

