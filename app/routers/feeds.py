from typing import List
from fastapi import APIRouter, Depends, status
from sqlmodel import select

from ..auth.oidc import get_current_user
from ..schemas import Feed as FeedSchema
from ..db import get_session
from ..models import Feed as FeedModel


router = APIRouter()


@router.get("", response_model=List[FeedSchema])
@router.get("/", response_model=List[FeedSchema])
def list_feeds(current_user=Depends(get_current_user), session=Depends(get_session)):
    user_id = current_user["sub"]
    stmt = select(FeedModel).where(FeedModel.owner_user_id == user_id)
    return session.exec(stmt).all()


@router.post("/", response_model=FeedSchema, status_code=status.HTTP_201_CREATED)
def create_feed(body: FeedSchema, current_user=Depends(get_current_user), session=Depends(get_session)):
    model = FeedModel(**body.model_dump())
    model.owner_user_id = current_user["sub"]
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
