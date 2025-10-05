from typing import List, Optional
from sqlalchemy import delete, func
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..auth import (
    PERMISSION_MANAGE_BOOKMARKS,
    PERMISSION_READ_GLOBAL_CREDENTIALS,
    has_permission,
)
from ..schemas import Feed as FeedSchema
from ..db import get_session
from ..models import (
    Credential as CredentialModel,
    Feed as FeedModel,
    FeedTagLink,
    Folder as FolderModel,
    Tag as TagModel,
)
from ..util.quotas import enforce_user_quota
from ..config import is_user_mgmt_enforce_enabled
from .credentials import _validate_site_config_assignment


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
    owner_specified: bool = False,
) -> Optional[str]:
    user_id = current_user.get("sub") if isinstance(current_user, dict) else None

    explicit_global_request = False
    if isinstance(requested_owner, str) and requested_owner.lower() == "global":
        requested_owner = None
        explicit_global_request = True
    elif requested_owner is None:
        explicit_global_request = owner_specified

    if requested_owner is None:
        if default_owner is None:
            return None
        if not explicit_global_request:
            return default_owner
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


def _normalize_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return str(value)


def _validate_feed_site_config_assignment(
    session,
    current_user,
    *,
    owner_id: Optional[str],
    site_config_id: Optional[str],
) -> Optional[str]:
    normalized_site_config_id = _normalize_optional(site_config_id)
    if not normalized_site_config_id:
        return None
    try:
        _validate_site_config_assignment(
            session,
            current_user,
            site_config_id=normalized_site_config_id,
            credential_owner_id=owner_id,
        )
    except HTTPException as exc:
        if (
            exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
            and exc.detail == "site_config_id does not belong to the credential owner"
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="site_config_id does not belong to the feed owner",
            ) from exc
        raise
    return normalized_site_config_id


def _validate_site_login_configuration(
    session,
    current_user,
    *,
    owner_id: Optional[str],
    site_config_id: Optional[str],
    site_login_credential_id: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    normalized_site_config_id = _normalize_optional(site_config_id)
    normalized_credential_id = _normalize_optional(site_login_credential_id)

    normalized_site_config_id = _validate_feed_site_config_assignment(
        session,
        current_user,
        owner_id=owner_id,
        site_config_id=normalized_site_config_id,
    )

    credential_owner_id = owner_id

    if normalized_credential_id:
        credential = session.get(CredentialModel, normalized_credential_id)
        if not credential:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="site_login_credential_id is invalid",
            )
        if credential.kind != "site_login":
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="site_login_credential_id must reference a site_login credential",
            )

        credential_owner_id = credential.owner_user_id
        if credential_owner_id is None:
            allowed_global = has_permission(
                session,
                current_user,
                PERMISSION_READ_GLOBAL_CREDENTIALS,
                owner_id=None,
            )
            if not allowed_global:
                raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
        else:
            if owner_id != credential_owner_id:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="site_login_credential_id does not belong to the feed owner",
                )

        if normalized_site_config_id:
            if credential.site_config_id and credential.site_config_id != normalized_site_config_id:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="site_config_id does not match site_login_credential_id",
                )
            normalized_site_config_id = _validate_feed_site_config_assignment(
                session,
                current_user,
                owner_id=owner_id,
                site_config_id=normalized_site_config_id,
            )
        else:
            normalized_site_config_id = credential.site_config_id

        if not normalized_site_config_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="site_login_credential_id requires an associated site_config_id",
            )
        normalized_site_config_id = _validate_feed_site_config_assignment(
            session,
            current_user,
            owner_id=owner_id,
            site_config_id=normalized_site_config_id,
        )
    else:
        credential_owner_id = owner_id

    return normalized_site_config_id, normalized_credential_id


def _validate_feed_folder(
    session,
    *,
    owner_id: Optional[str],
    folder_id: Optional[str],
) -> Optional[str]:
    normalized_folder_id = _normalize_optional(folder_id)
    if not normalized_folder_id:
        return None
    folder = session.get(FolderModel, normalized_folder_id)
    if not folder:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="folder_id is invalid",
        )
    if folder.owner_user_id != owner_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="folder_id does not belong to the feed owner",
        )
    return folder.id


def _validate_feed_tags(
    session,
    *,
    owner_id: Optional[str],
    tag_ids: List[str],
) -> List[str]:
    if not tag_ids:
        return []
    normalized_ids: List[str] = []
    seen: set[str] = set()
    for raw_id in tag_ids:
        tag_id = str(raw_id).strip()
        if not tag_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="tag_ids may not contain blank identifiers",
            )
        if tag_id in seen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="tag_ids may not contain duplicates",
            )
        seen.add(tag_id)
        normalized_ids.append(tag_id)

    rows = session.exec(
        select(TagModel).where(TagModel.id.in_(normalized_ids))
    ).all()
    tag_map = {tag.id: tag for tag in rows}
    missing = [tag_id for tag_id in normalized_ids if tag_id not in tag_map]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="tag_ids contains invalid tag references",
        )

    for tag_id in normalized_ids:
        tag = tag_map[tag_id]
        if tag.owner_user_id != owner_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="tag_ids must belong to the feed owner",
            )

    return normalized_ids


def _apply_feed_tags(session, *, feed_id: str, tag_ids: List[str]) -> None:
    session.exec(delete(FeedTagLink).where(FeedTagLink.feed_id == feed_id))
    for position, tag_id in enumerate(tag_ids):
        session.add(
            FeedTagLink(feed_id=feed_id, tag_id=tag_id, position=position)
        )


def _get_feed_tag_map(session, feed_ids: List[str]) -> dict[str, List[str]]:
    if not feed_ids:
        return {}
    rows = session.exec(
        select(FeedTagLink)
        .where(FeedTagLink.feed_id.in_(feed_ids))
        .order_by(FeedTagLink.feed_id, FeedTagLink.position)
    ).all()
    tag_map: dict[str, List[str]] = {}
    for row in rows:
        tag_map.setdefault(row.feed_id, []).append(row.tag_id)
    return tag_map


def _feed_to_schema(
    session,
    feed: FeedModel,
    tag_map: Optional[dict[str, List[str]]] = None,
) -> FeedSchema:
    if tag_map is None:
        tag_map = _get_feed_tag_map(session, [feed.id])
    tag_ids = tag_map.get(feed.id, [])
    return FeedSchema(
        id=feed.id,
        url=feed.url,
        poll_frequency=feed.poll_frequency,
        initial_lookback_period=feed.initial_lookback_period,
        is_paywalled=feed.is_paywalled,
        rss_requires_auth=feed.rss_requires_auth,
        site_config_id=feed.site_config_id,
        owner_user_id=feed.owner_user_id,
        site_login_credential_id=feed.site_login_credential_id,
        folder_id=feed.folder_id,
        tag_ids=tag_ids,
        last_rss_poll_at=feed.last_rss_poll_at,
    )


@router.get("", response_model=List[FeedSchema])
@router.get("/", response_model=List[FeedSchema])
def list_feeds(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    stmt = select(FeedModel).where(FeedModel.owner_user_id == user_id)
    records = session.exec(stmt).all()
    tag_map = _get_feed_tag_map(session, [record.id for record in records])
    return [_feed_to_schema(session, record, tag_map) for record in records]


@router.post("/", response_model=FeedSchema, status_code=status.HTTP_201_CREATED)
def create_feed(body: FeedSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
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
            count_stmt=select(func.count()).select_from(FeedModel).where(
                FeedModel.owner_user_id == owner_id
            ),
        )
    model.owner_user_id = owner_id
    session.add(model)
    session.flush()
    _apply_feed_tags(session, feed_id=model.id, tag_ids=validated_tag_ids)
    session.commit()
    session.refresh(model)
    return _feed_to_schema(session, model)


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
    lookback_specified = "initial_lookback_period" in update_payload
    has_polled = model.last_rss_poll_at is not None
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
                count_stmt=select(func.count()).select_from(FeedModel).where(
                    FeedModel.owner_user_id == new_owner
                ),
            )
        model.owner_user_id = new_owner
    # Update allowed fields
    model.url = str(body.url)
    model.poll_frequency = body.poll_frequency
    if lookback_specified and not has_polled:
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
    return _feed_to_schema(session, model)
