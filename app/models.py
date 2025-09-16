from typing import Optional, List, Dict
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, UniqueConstraint
from sqlmodel import SQLModel, Field, Column
from datetime import datetime


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class SiteConfig(SQLModel, table=True):
    __tablename__ = "siteconfig"
    id: str = Field(default_factory=lambda: gen_id("sc"), primary_key=True)
    name: str
    site_url: str
    username_selector: str
    password_selector: str
    login_button_selector: str
    post_login_selector: Optional[str] = None
    cookies_to_store: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    owner_user_id: Optional[str] = Field(default=None, index=True)  # None => global


class Feed(SQLModel, table=True):
    __tablename__ = "feed"
    id: str = Field(default_factory=lambda: gen_id("feed"), primary_key=True)
    url: str
    poll_frequency: str = "1h"
    initial_lookback_period: Optional[str] = None
    is_paywalled: bool = False
    rss_requires_auth: bool = False
    site_config_id: Optional[str] = Field(default=None, index=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)


class Credential(SQLModel, table=True):
    __tablename__ = "credential"
    id: str = Field(default_factory=lambda: gen_id("cred"), primary_key=True)
    kind: str  # instapaper|miniflux|site_login|substack
    data: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    owner_user_id: Optional[str] = Field(default=None, index=True)


class Job(SQLModel, table=True):
    __tablename__ = "job"
    id: str = Field(default_factory=lambda: gen_id("job"), primary_key=True)
    type: str  # login|miniflux_refresh|rss_poll|publish|retention
    payload: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = Field(default="queued", index=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    attempts: int = Field(default=0)
    last_error: Optional[str] = None
    available_at: Optional[float] = Field(default=None, index=True)
    dead_at: Optional[float] = Field(default=None, index=True)
    details: Dict = Field(default_factory=dict, sa_column=Column(JSON))


class Cookie(SQLModel, table=True):
    __tablename__ = "cookie"
    id: str = Field(default_factory=lambda: gen_id("cookie"), primary_key=True)
    # A stable key per user+site config for easy lookup
    cookie_key: str = Field(index=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    site_config_id: Optional[str] = Field(default=None, index=True)
    cookies: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    last_refresh: Optional[str] = None  # ISO timestamp
    expiry_hint: Optional[float] = None  # earliest expiry epoch among required cookies


class Bookmark(SQLModel, table=True):
    __tablename__ = "bookmark"
    id: str = Field(default_factory=lambda: gen_id("bm"), primary_key=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    instapaper_bookmark_id: str = Field(index=True)
    url: Optional[str] = None
    title: Optional[str] = None
    content_location: Optional[str] = None
    feed_id: Optional[str] = Field(default=None, index=True)
    published_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))


class Tag(SQLModel, table=True):
    __tablename__ = "tag"
    __table_args__ = (UniqueConstraint("owner_user_id", "name", name="uq_tag_owner_name"),)

    id: str = Field(default_factory=lambda: gen_id("tag"), primary_key=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    name: str = Field(index=True)


class Folder(SQLModel, table=True):
    __tablename__ = "folder"
    __table_args__ = (UniqueConstraint("owner_user_id", "name", name="uq_folder_owner_name"),)

    id: str = Field(default_factory=lambda: gen_id("fld"), primary_key=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    name: str = Field(index=True)
    instapaper_folder_id: Optional[str] = Field(default=None, index=True)


class BookmarkTagLink(SQLModel, table=True):
    __tablename__ = "bookmark_tag_link"

    bookmark_id: str = Field(sa_column=Column(ForeignKey("bookmark.id", ondelete="CASCADE"), primary_key=True))
    tag_id: str = Field(sa_column=Column(ForeignKey("tag.id", ondelete="CASCADE"), primary_key=True))


class BookmarkFolderLink(SQLModel, table=True):
    __tablename__ = "bookmark_folder_link"

    bookmark_id: str = Field(sa_column=Column(ForeignKey("bookmark.id", ondelete="CASCADE"), primary_key=True))
    folder_id: str = Field(sa_column=Column(ForeignKey("folder.id", ondelete="CASCADE"), primary_key=True))
