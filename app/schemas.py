from typing import List, Optional
from pydantic import BaseModel, Field, AnyHttpUrl


class User(BaseModel):
    sub: str
    email: Optional[str] = None
    name: Optional[str] = None
    groups: List[str] = Field(default_factory=list)


class SiteConfig(BaseModel):
    id: Optional[str] = None
    name: str
    site_url: AnyHttpUrl
    username_selector: str
    password_selector: str
    login_button_selector: str
    post_login_selector: Optional[str] = None
    cookies_to_store: List[str] = Field(default_factory=list)
    owner_user_id: Optional[str] = None  # None means global


class Feed(BaseModel):
    id: Optional[str] = None
    url: AnyHttpUrl
    poll_frequency: str = "1h"
    initial_lookback_period: Optional[str] = None
    is_paywalled: bool = False
    rss_requires_auth: bool = False
    site_config_id: Optional[str] = None
    owner_user_id: Optional[str] = None


class Credential(BaseModel):
    id: Optional[str] = None
    kind: str  # instapaper|miniflux|site_login|substack
    data: dict  # Placeholder; to be encrypted at rest in a real impl
    owner_user_id: Optional[str] = None


class JobRequest(BaseModel):
    type: str  # login|miniflux_refresh|rss_poll|publish|retention
    payload: dict


class StatusResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"


class BookmarkOut(BaseModel):
    id: str
    instapaper_bookmark_id: str
    title: Optional[str] = None
    url: Optional[str] = None
    content_location: Optional[str] = None
    feed_id: Optional[str] = None
    published_at: Optional[str] = None


class BookmarksPage(BaseModel):
    items: List[BookmarkOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class JobOut(BaseModel):
    id: str
    type: str
    status: str
    attempts: int
    last_error: Optional[str] = None
    available_at: Optional[float] = None
    owner_user_id: Optional[str] = None
    payload: dict
    details: dict = Field(default_factory=dict)


class JobsPage(BaseModel):
    items: List[JobOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class SiteConfigOut(BaseModel):
    id: str
    name: str
    site_url: str
    username_selector: str
    password_selector: str
    login_button_selector: str
    post_login_selector: Optional[str] = None
    cookies_to_store: List[str] = Field(default_factory=list)
    owner_user_id: Optional[str] = None


class SiteConfigsPage(BaseModel):
    items: List[SiteConfigOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class CredentialsPage(BaseModel):
    items: List[Credential]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class FeedOut(BaseModel):
    id: str
    url: str
    poll_frequency: str
    initial_lookback_period: Optional[str] = None
    is_paywalled: bool = False
    rss_requires_auth: bool = False
    site_config_id: Optional[str] = None
    owner_user_id: Optional[str] = None


class FeedsPage(BaseModel):
    items: List[FeedOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class TagCreate(BaseModel):
    name: str = Field(..., min_length=1)


class TagUpdate(BaseModel):
    name: str = Field(..., min_length=1)


class TagOut(BaseModel):
    id: str
    name: str
    bookmark_count: int = 0


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1)
    instapaper_folder_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    instapaper_folder_id: Optional[str] = None


class FolderOut(BaseModel):
    id: str
    name: str
    instapaper_folder_id: Optional[str] = None
    bookmark_count: int = 0


class BookmarkTagsUpdate(BaseModel):
    tags: List[str] = Field(default_factory=list)


class BookmarkFolderUpdate(BaseModel):
    folder_id: Optional[str] = None
    folder_name: Optional[str] = Field(default=None, min_length=1)
    instapaper_folder_id: Optional[str] = None
