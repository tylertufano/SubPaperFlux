from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlmodel import Session

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..auth.users import ensure_user_from_identity
from ..db import get_session
from ..models import User
from ..schemas import MeNotificationPreferences, MeOut, MeUpdate


router = APIRouter(prefix="/v1/me", tags=["v1", "me"])

SUPPORTED_LOCALES = {"en", "pseudo"}

DEFAULT_NOTIFICATION_PREFERENCES: dict[str, bool] = {
    "email_job_updates": True,
    "email_digest": False,
}


def _require_user_id(current_user) -> str:
    user_id = current_user.get("sub") if isinstance(current_user, dict) else None
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing user identifier")
    return str(user_id)


def _ensure_user(session: Session, current_user) -> User:
    _require_user_id(current_user)
    try:
        user, created, updated = ensure_user_from_identity(session, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if created or updated:
        session.commit()
        session.refresh(user)
    return user


def _normalize_locale(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text not in SUPPORTED_LOCALES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported locale")
    return text


def _normalize_notification_preferences(preferences: Mapping[str, Any] | None) -> dict[str, bool]:
    normalized: dict[str, bool] = dict(DEFAULT_NOTIFICATION_PREFERENCES)
    if isinstance(preferences, Mapping):
        for key, value in preferences.items():
            normalized[key] = bool(value)
    return normalized


def _serialize_user(user: User) -> MeOut:
    preferences = _normalize_notification_preferences(user.notification_preferences)
    return MeOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        picture_url=user.picture_url,
        locale=user.locale,
        notification_preferences=MeNotificationPreferences(**preferences),
    )


@router.get("", response_model=MeOut, summary="Get current user profile")
def get_me(current_user=Depends(get_current_user), session: Session = Depends(get_session)) -> MeOut:
    user = _ensure_user(session, current_user)
    return _serialize_user(user)


@router.patch("", response_model=MeOut, summary="Update current user profile")
def update_me(
    payload: MeUpdate = Body(...),
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MeOut:
    user = _ensure_user(session, current_user)

    changes: dict[str, Any] = {}
    updated = False

    if "locale" in payload.model_fields_set:
        previous_locale = user.locale
        locale = _normalize_locale(payload.locale)
        if previous_locale != locale:
            user.locale = locale
            updated = True
            changes["locale"] = {"previous": previous_locale, "next": locale}

    if payload.notification_preferences is not None:
        previous_preferences = _normalize_notification_preferences(user.notification_preferences)
        updates = payload.notification_preferences.model_dump(exclude_unset=True)
        merged = dict(previous_preferences)
        if updates:
            for key, value in updates.items():
                merged[key] = bool(value)
        if merged != previous_preferences:
            user.notification_preferences = merged
            updated = True
            changes["notification_preferences"] = {
                "previous": previous_preferences,
                "next": merged,
            }

    if updated:
        user.updated_at = datetime.now(timezone.utc)
        session.add(user)
        if changes:
            record_audit_log(
                session,
                entity_type="user",
                entity_id=user.id,
                action="update_preferences",
                owner_user_id=user.id,
                actor_user_id=user.id,
                details=changes,
            )
        session.commit()
        session.refresh(user)

    return _serialize_user(user)

