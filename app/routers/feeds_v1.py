from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..auth import PERMISSION_READ_BOOKMARKS, has_permission
from ..config import is_user_mgmt_enforce_enabled
from ..db import get_session
from ..models import Feed as FeedModel
from ..schemas import Feed as FeedSchema
from ..schemas import FeedsPage, FeedOut
from ..security.csrf import csrf_protect
from ..util.quotas import enforce_user_quota
from .feeds import (
    _ensure_feed_permission,
    _feed_to_schema,
    _get_feed_tag_map,
    _resolve_owner,
    _validate_feed_folder,
    _validate_site_login_configuration,
    _validate_feed_tags,
    _apply_feed_tags,
)


router = APIRouter(prefix="/v1/feeds", tags=["v1"])


def _feed_to_out(
    session,
    model: FeedModel,
    tag_map: Optional[dict[str, List[str]]] = None,
) -> FeedOut:
    payload = _feed_to_schema(session, model, tag_map=tag_map).model_dump(mode="json")
    return FeedOut(**payload)


@router.get("", response_model=FeedsPage, summary="List feeds")
def list_feeds_v1(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    owner_user_ids: Optional[List[str]] = Query(
        None,
        description="Filter by one or more owner ids. Repeat the parameter for multiple owners.",
    ),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
):
    user_id = current_user["sub"]
    enforcement_enabled = is_user_mgmt_enforce_enabled()

    normalized_owner_ids: List[Optional[str]] = []
    seen_ids: set[str] = set()
    if owner_user_ids:
        for raw in owner_user_ids:
            owner_value: Optional[str]
            if raw is None:
                owner_value = None
            else:
                raw_value = str(raw).strip()
                if not raw_value:
                    owner_value = None
                else:
                    lowered = raw_value.lower()
                    if lowered in {"null", "none", "global"}:
                        owner_value = None
                    elif lowered in {"me", "self"}:
                        owner_value = user_id
                    else:
                        owner_value = raw_value
            key = owner_value if owner_value is not None else "__global__"
            if key in seen_ids:
                continue
            seen_ids.add(key)
            normalized_owner_ids.append(owner_value)
    if not normalized_owner_ids:
        normalized_owner_ids = [user_id]

    allowed_owner_ids: List[str] = []
    allowed_owner_ids_set: set[str] = set()
    include_global = False
    unauthorized_requested: List[Optional[str]] = []

    for owner_id in normalized_owner_ids:
        if owner_id is None:
            allowed = has_permission(
                session,
                current_user,
                PERMISSION_READ_BOOKMARKS,
                owner_id=None,
            )
            if allowed:
                include_global = True
            else:
                unauthorized_requested.append(owner_id)
            continue

        if owner_id == user_id and owner_id not in allowed_owner_ids_set:
            allowed_owner_ids.append(owner_id)
            allowed_owner_ids_set.add(owner_id)
            continue

        allowed = has_permission(
            session,
            current_user,
            PERMISSION_READ_BOOKMARKS,
            owner_id=owner_id,
        )
        if allowed:
            if owner_id not in allowed_owner_ids_set:
                allowed_owner_ids.append(owner_id)
                allowed_owner_ids_set.add(owner_id)
        else:
            unauthorized_requested.append(owner_id)

    if enforcement_enabled and unauthorized_requested:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")

    filters = []
    if allowed_owner_ids:
        filters.append(FeedModel.owner_user_id.in_(allowed_owner_ids))
    if include_global:
        filters.append(FeedModel.owner_user_id.is_(None))

    if filters:
        stmt = select(FeedModel)
        if len(filters) == 1:
            stmt = stmt.where(filters[0])
        else:
            stmt = stmt.where(or_(*filters))
        records = session.exec(stmt).all()
    else:
        records = []

    if enforcement_enabled and records:
        def _is_authorized(feed: FeedModel) -> bool:
            if feed.owner_user_id == user_id:
                return True
            return has_permission(
                session,
                current_user,
                PERMISSION_READ_BOOKMARKS,
                owner_id=feed.owner_user_id,
            )

        records = [feed for feed in records if _is_authorized(feed)]

    total = len(records)
    start = (page - 1) * size
    end = start + size
    rows = records[start:end]

    tag_map = _get_feed_tag_map(session, [record.id for record in rows])
    items = [_feed_to_out(session, r, tag_map=tag_map) for r in rows]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return FeedsPage(items=items, total=total, page=page, size=size, has_next=has_next, total_pages=total_pages)


@router.get(
    "/{feed_id}",
    response_model=FeedOut,
    summary="Get feed",
)
def get_feed_v1(
    feed_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(FeedModel, feed_id)
    if not model:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    if not _ensure_feed_permission(
        session,
        current_user,
        owner_id=model.owner_user_id,
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    return _feed_to_out(session, model)


@router.post(
    "",
    response_model=FeedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
    summary="Create feed",
)
def create_feed_v1(
    body: FeedSchema,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    payload = body.model_dump(mode="json")
    tag_ids = payload.pop("tag_ids", [])
    requested_owner = payload.get("owner_user_id")
    owner_specified = "owner_user_id" in getattr(body, "model_fields_set", set())
    owner_id = _resolve_owner(
        session,
        current_user,
        requested_owner,
        default_owner=current_user.get("sub"),
        owner_specified=owner_specified,
    )
    payload["owner_user_id"] = owner_id

    normalized_site_config_id, normalized_credential_id = _validate_site_login_configuration(
        session,
        current_user,
        owner_id=owner_id,
        site_config_id=payload.get("site_config_id"),
        site_login_credential_id=payload.get("site_login_credential_id"),
    )

    payload["site_config_id"] = normalized_site_config_id
    payload["site_login_credential_id"] = normalized_credential_id
    payload["folder_id"] = _validate_feed_folder(
        session,
        owner_id=owner_id,
        folder_id=payload.get("folder_id"),
    )
    validated_tag_ids = _validate_feed_tags(
        session,
        owner_id=owner_id,
        tag_ids=tag_ids,
    )

    model = FeedModel(**payload)

    if owner_id is not None:
        enforce_user_quota(
            session,
            owner_id,
            quota_field="quota_feeds",
            resource_name="Feed",
            count_stmt=select(func.count())
            .select_from(FeedModel)
            .where(FeedModel.owner_user_id == owner_id),
        )

    model.owner_user_id = owner_id
    session.add(model)
    session.flush()
    _apply_feed_tags(session, feed_id=model.id, tag_ids=validated_tag_ids)
    session.commit()
    session.refresh(model)

    return _feed_to_out(session, model)


@router.put(
    "/{feed_id}",
    response_model=FeedOut,
    dependencies=[Depends(csrf_protect)],
    summary="Update feed",
)
def update_feed_v1(
    feed_id: str,
    body: FeedSchema,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(FeedModel, feed_id)
    if not model:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    if not _ensure_feed_permission(
        session,
        current_user,
        owner_id=model.owner_user_id,
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    original_owner = model.owner_user_id
    update_payload = body.model_dump(mode="json", exclude_unset=True)

    if "owner_user_id" in update_payload:
        requested_owner = update_payload.get("owner_user_id")
        new_owner = _resolve_owner(
            session,
            current_user,
            requested_owner,
            default_owner=original_owner,
            owner_specified=True,
        )
        if new_owner != original_owner and new_owner is not None:
            enforce_user_quota(
                session,
                new_owner,
                quota_field="quota_feeds",
                resource_name="Feed",
                count_stmt=select(func.count())
                .select_from(FeedModel)
                .where(FeedModel.owner_user_id == new_owner),
            )
        model.owner_user_id = new_owner

    model.url = str(body.url)
    model.poll_frequency = body.poll_frequency
    model.initial_lookback_period = body.initial_lookback_period
    model.is_paywalled = body.is_paywalled
    model.rss_requires_auth = body.rss_requires_auth

    normalized_site_config_id, normalized_credential_id = _validate_site_login_configuration(
        session,
        current_user,
        owner_id=model.owner_user_id,
        site_config_id=body.site_config_id,
        site_login_credential_id=body.site_login_credential_id,
    )

    model.site_config_id = normalized_site_config_id
    model.site_login_credential_id = normalized_credential_id
    model.folder_id = _validate_feed_folder(
        session,
        owner_id=model.owner_user_id,
        folder_id=body.folder_id,
    )
    validated_tag_ids = _validate_feed_tags(
        session,
        owner_id=model.owner_user_id,
        tag_ids=body.tag_ids,
    )

    session.add(model)
    session.flush()
    _apply_feed_tags(session, feed_id=model.id, tag_ids=validated_tag_ids)
    session.commit()
    session.refresh(model)

    return _feed_to_out(session, model)


@router.delete(
    "/{feed_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
    summary="Delete feed",
)
def delete_feed_v1(
    feed_id: str,
    current_user=Depends(get_current_user),
    session=Depends(get_session),
):
    model = session.get(FeedModel, feed_id)
    if not model:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    if not _ensure_feed_permission(
        session,
        current_user,
        owner_id=model.owner_user_id,
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    session.delete(model)
    session.commit()

    return None
