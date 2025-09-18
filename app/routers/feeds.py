from typing import List, Optional
from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..auth import PERMISSION_MANAGE_BOOKMARKS, has_permission
from ..schemas import Feed as FeedSchema
from ..db import get_session
from ..models import Feed as FeedModel
from ..util.quotas import enforce_user_quota
from ..config import is_user_mgmt_enforce_enabled


router = APIRouter()


def _ensure_feed_permission(
    session,
    current_user,
    *,
    owner_id: Optional[str],
) -> bool:
    user_id = current_user.get("sub") if isinstance(current_user, dict) else None
    if owner_id is not None and owner_id == user_id:
        return True

    allowed = has_permission(
        session,
        current_user,
        PERMISSION_MANAGE_BOOKMARKS,
        owner_id=owner_id,
    )
    if is_user_mgmt_enforce_enabled() and not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return allowed


def _resolve_owner(
    session,
    current_user,
    requested_owner: Optional[str],
    *,
    default_owner: Optional[str],
) -> Optional[str]:
    user_id = current_user.get("sub") if isinstance(current_user, dict) else None

    if requested_owner is None:
        if default_owner is None:
            return None
        allowed_global = _ensure_feed_permission(
            session,
            current_user,
            owner_id=None,
        )
        if allowed_global:
            return None
        return default_owner

    if requested_owner == default_owner:
        return default_owner

    if user_id and requested_owner == user_id:
        return user_id

    allowed_cross = _ensure_feed_permission(
        session,
        current_user,
        owner_id=requested_owner,
    )
    if allowed_cross:
        return requested_owner

    return default_owner


@router.get("", response_model=List[FeedSchema])
@router.get("/", response_model=List[FeedSchema])
def list_feeds(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    stmt = select(FeedModel).where(FeedModel.owner_user_id == user_id)
    return session.exec(stmt).all()


@router.post("/", response_model=FeedSchema, status_code=status.HTTP_201_CREATED)
def create_feed(body: FeedSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    payload = body.model_dump(mode="json")
    requested_owner = payload.get("owner_user_id")
    owner_id = _resolve_owner(
        session,
        current_user,
        requested_owner,
        default_owner=current_user.get("sub"),
    )
    payload["owner_user_id"] = owner_id
    model = FeedModel(**payload)
    if owner_id is not None:
        enforce_user_quota(
            session,
            owner_id,
            quota_field="quota_feeds",
            resource_name="Feed",
            count_stmt=select(func.count()).select_from(FeedModel).where(
                FeedModel.owner_user_id == owner_id
            ),
        )
    model.owner_user_id = owner_id
    session.add(model)
    session.commit()
    session.refresh(model)
    return model


@router.delete("/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feed(feed_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(FeedModel, feed_id)
    if not model:
        return None
    if not _ensure_feed_permission(
        session,
        current_user,
        owner_id=model.owner_user_id,
    ):
        return None
    session.delete(model)
    session.commit()
    return None


@router.put("/{feed_id}", response_model=FeedSchema)
def update_feed(feed_id: str, body: FeedSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(FeedModel, feed_id)
    if not model:
        return None
    original_owner = model.owner_user_id
    if not _ensure_feed_permission(
        session,
        current_user,
        owner_id=model.owner_user_id,
    ):
        return None
    update_payload = body.model_dump(mode="json", exclude_unset=True)
    if "owner_user_id" in update_payload:
        requested_owner = update_payload.get("owner_user_id")
        new_owner = _resolve_owner(
            session,
            current_user,
            requested_owner,
            default_owner=original_owner,
        )
        if new_owner != original_owner and new_owner is not None:
            enforce_user_quota(
                session,
                new_owner,
                quota_field="quota_feeds",
                resource_name="Feed",
                count_stmt=select(func.count()).select_from(FeedModel).where(
                    FeedModel.owner_user_id == new_owner
                ),
            )
        model.owner_user_id = new_owner
    # Update allowed fields
    model.url = body.url
    model.poll_frequency = body.poll_frequency
    model.initial_lookback_period = body.initial_lookback_period
    model.is_paywalled = body.is_paywalled
    model.rss_requires_auth = body.rss_requires_auth
    model.site_config_id = body.site_config_id
    session.add(model)
    session.commit()
    session.refresh(model)
    return model
