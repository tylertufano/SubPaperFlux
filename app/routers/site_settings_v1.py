"""Versioned endpoints for configurable site settings."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..audit import record_audit_log
from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import SiteSetting
from ..routers.admin import _require_admin
from ..schemas import (
    SiteSetupStatus,
    SiteSetupStatusOut,
    SiteSetupStatusUpdate,
    SiteWelcomeContent,
    SiteWelcomeSettingOut,
    SiteWelcomeSettingUpdate,
)

router = APIRouter(prefix="/v1/site-settings", tags=["v1", "site-settings"])

WELCOME_SETTING_KEY = "welcome"
SETUP_STATUS_KEY = "setup_status"


def _serialize_site_setting(setting: Optional[SiteSetting]) -> SiteWelcomeSettingOut:
    if setting is None:
        return SiteWelcomeSettingOut(
            key=WELCOME_SETTING_KEY,
            value=SiteWelcomeContent(),
            created_at=None,
            updated_at=None,
            updated_by_user_id=None,
        )

    content = SiteWelcomeContent.model_validate(setting.value or {})
    return SiteWelcomeSettingOut(
        key=setting.key,
        value=content,
        created_at=setting.created_at,
        updated_at=setting.updated_at,
        updated_by_user_id=setting.updated_by_user_id,
    )


def _serialize_setup_status(setting: Optional[SiteSetting]) -> SiteSetupStatusOut:
    if setting is None:
        return SiteSetupStatusOut(
            key=SETUP_STATUS_KEY,
            value=SiteSetupStatus(),
            created_at=None,
            updated_at=None,
            updated_by_user_id=None,
        )

    status = SiteSetupStatus.model_validate(setting.value or {})
    return SiteSetupStatusOut(
        key=setting.key,
        value=status,
        created_at=setting.created_at,
        updated_at=setting.updated_at,
        updated_by_user_id=setting.updated_by_user_id,
    )


@router.get(
    "/welcome",
    response_model=SiteWelcomeSettingOut,
    summary="Retrieve the public welcome message",
)
def get_welcome_setting(session: Session = Depends(get_session)) -> SiteWelcomeSettingOut:
    setting = session.get(SiteSetting, WELCOME_SETTING_KEY)
    return _serialize_site_setting(setting)


def _apply_updates(setting: SiteSetting, updates: Dict[str, Any], *, actor_id: str) -> None:
    now = datetime.now(timezone.utc)
    merged = dict(setting.value or {})
    merged.update(updates)
    setting.value = merged
    setting.updated_at = now
    setting.updated_by_user_id = actor_id


@router.put(
    "/welcome",
    response_model=SiteWelcomeSettingOut,
    summary="Create or replace the welcome message",
)
@router.patch(
    "/welcome",
    response_model=SiteWelcomeSettingOut,
    summary="Partially update the welcome message",
)
def update_welcome_setting(
    payload: SiteWelcomeSettingUpdate,
    *,
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SiteWelcomeSettingOut:
    actor_id = _require_admin(session, current_user)
    updates = payload.model_dump(exclude_unset=True, mode="json")

    setting = session.get(SiteSetting, WELCOME_SETTING_KEY)
    if setting is None:
        setting = SiteSetting(key=WELCOME_SETTING_KEY, value={})
        session.add(setting)

    _apply_updates(setting, updates, actor_id=actor_id)

    value_snapshot = dict(setting.value or {})

    record_audit_log(
        session,
        entity_type="site_setting",
        entity_id=WELCOME_SETTING_KEY,
        action="update",
        owner_user_id=None,
        actor_user_id=actor_id,
        details={"value": value_snapshot},
    )
    session.commit()
    session.refresh(setting)
    return _serialize_site_setting(setting)


@router.get(
    "/setup-status",
    response_model=SiteSetupStatusOut,
    summary="Retrieve setup progress",
)
def get_setup_status(
    *,
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SiteSetupStatusOut:
    _require_admin(session, current_user)
    setting = session.get(SiteSetting, SETUP_STATUS_KEY)
    return _serialize_setup_status(setting)


@router.put(
    "/setup-status",
    response_model=SiteSetupStatusOut,
    summary="Create or replace setup progress",
)
def update_setup_status(
    payload: SiteSetupStatusUpdate,
    *,
    current_user=Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SiteSetupStatusOut:
    actor_id = _require_admin(session, current_user)
    setting = session.get(SiteSetting, SETUP_STATUS_KEY)
    if setting is None:
        setting = SiteSetting(key=SETUP_STATUS_KEY, value={})
        session.add(setting)

    now = datetime.now(timezone.utc)
    setting.value = payload.model_dump(mode="json")
    setting.updated_at = now
    setting.updated_by_user_id = actor_id

    value_snapshot = dict(setting.value or {})

    record_audit_log(
        session,
        entity_type="site_setting",
        entity_id=SETUP_STATUS_KEY,
        action="update",
        owner_user_id=None,
        actor_user_id=actor_id,
        details={"value": value_snapshot},
    )
    session.commit()
    session.refresh(setting)
    return _serialize_setup_status(setting)
