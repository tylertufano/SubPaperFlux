from typing import List
from sqlalchemy import func
from fastapi import APIRouter, Depends, status
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..schemas import Feed as FeedSchema
from ..db import get_session
from ..models import Feed as FeedModel
from ..util.quotas import enforce_user_quota


router = APIRouter()


@router.get("", response_model=List[FeedSchema])
@router.get("/", response_model=List[FeedSchema])
def list_feeds(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    stmt = select(FeedModel).where(FeedModel.owner_user_id == user_id)
    return session.exec(stmt).all()


@router.post("/", response_model=FeedSchema, status_code=status.HTTP_201_CREATED)
def create_feed(body: FeedSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    payload = body.model_dump(mode="json")
    model = FeedModel(**payload)
    owner_id = current_user["sub"]
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
    if not model or model.owner_user_id != current_user["sub"]:
        return None
    session.delete(model)
    session.commit()
    return None


@router.put("/{feed_id}", response_model=FeedSchema)
def update_feed(feed_id: str, body: FeedSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = session.get(FeedModel, feed_id)
    if not model or model.owner_user_id != current_user["sub"]:
        return None
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
