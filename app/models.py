from enum import Enum
from typing import Optional, List, Dict, Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import SQLModel, Field, Column, Relationship
from datetime import datetime, timezone


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class User(SQLModel, table=True):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)

    id: str = Field(primary_key=True)
    email: Optional[str] = Field(default=None, index=True)
    full_name: Optional[str] = None
    picture_url: Optional[str] = None
    is_active: bool = Field(default=True, index=True)
    claims: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    locale: Optional[str] = Field(default=None, index=True)
    notification_preferences: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    quota_credentials: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    quota_site_configs: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    quota_feeds: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    quota_api_tokens: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_login_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    organization_memberships: List["OrganizationMembership"] = Relationship(
        back_populates="user"
    )

    @property
    def organizations(self) -> List["Organization"]:
        return [
            membership.organization
            for membership in self.organization_memberships
            if membership.organization is not None
        ]


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_organizations_slug"),
        UniqueConstraint("name", name="uq_organizations_name"),
    )

    id: str = Field(default_factory=lambda: gen_id("org"), primary_key=True)
    slug: str = Field(sa_column=Column(String(length=255), nullable=False, index=True))
    name: str = Field(sa_column=Column(String(length=255), nullable=False, index=True))
    description: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    is_default: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, index=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    memberships: List["OrganizationMembership"] = Relationship(
        back_populates="organization"
    )


class OrganizationMembership(SQLModel, table=True):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_organization_memberships_org_user",
        ),
    )

    organization_id: str = Field(
        sa_column=Column(
            ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    user_id: str = Field(
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        )
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    organization: Optional[Organization] = Relationship(back_populates="memberships")
    user: Optional[User] = Relationship(back_populates="organization_memberships")


class Role(SQLModel, table=True):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("name", name="uq_roles_name"),)

    id: str = Field(default_factory=lambda: gen_id("role"), primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    is_system: bool = Field(default=False, index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class UserRole(SQLModel, table=True):
    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
    )

    user_id: str = Field(
        sa_column=Column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    )
    role_id: str = Field(
        sa_column=Column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    )
    granted_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    granted_by_user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )


class ApiToken(SQLModel, table=True):
    __tablename__ = "api_tokens"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_api_tokens_user_name"),
        UniqueConstraint("token_hash", name="uq_api_tokens_token_hash"),
    )

    id: str = Field(default_factory=lambda: gen_id("tok"), primary_key=True)
    user_id: str = Field(
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    name: str = Field(index=True)
    description: Optional[str] = None
    token_hash: str
    scopes: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_used_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    revoked_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class SiteLoginType(str, Enum):
    SELENIUM = "selenium"
    API = "api"


class SiteConfig(SQLModel, table=True):
    __tablename__ = "siteconfig"
    id: str = Field(default_factory=lambda: gen_id("sc"), primary_key=True)
    name: str
    site_url: str
    login_type: SiteLoginType = Field(
        default=SiteLoginType.SELENIUM,
        sa_column=Column(
            String(length=32),
            nullable=False,
            server_default=SiteLoginType.SELENIUM.value,
        ),
    )
    selenium_config: Optional[Dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    api_config: Optional[Dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    owner_user_id: Optional[str] = Field(default=None, index=True)  # None => global

    def __init__(self, **data: Any):  # type: ignore[override]
        selenium_config = data.pop("selenium_config", None)
        api_config = data.pop("api_config", None)
        legacy_fields = {}
        for key in (
            "username_selector",
            "password_selector",
            "login_button_selector",
            "post_login_selector",
            "cookies_to_store",
        ):
            if key in data:
                legacy_fields[key] = data.pop(key)
        super().__init__(**data)
        merged_config: Dict[str, Any] = dict(selenium_config or {})
        if legacy_fields:
            merged_config.update(legacy_fields)
        if (
            "cookies_to_store" in merged_config
            and merged_config["cookies_to_store"] is None
        ):
            merged_config["cookies_to_store"] = []
        self.selenium_config = merged_config or None
        self.api_config = dict(api_config or {}) or None

    def _get_selenium_value(self, key: str) -> Optional[Any]:
        config = self.selenium_config or {}
        value = config.get(key)
        if key == "cookies_to_store":
            return list(value or [])
        return value

    def _set_selenium_value(self, key: str, value: Any) -> None:
        config = dict(self.selenium_config or {})
        if value is None and key != "cookies_to_store":
            config.pop(key, None)
        else:
            if key == "cookies_to_store":
                value = list(value or [])
            config[key] = value
        self.selenium_config = config or None

    @property
    def username_selector(self) -> Optional[str]:
        return self._get_selenium_value("username_selector")

    @username_selector.setter
    def username_selector(self, value: Optional[str]) -> None:
        self._set_selenium_value("username_selector", value)

    @property
    def password_selector(self) -> Optional[str]:
        return self._get_selenium_value("password_selector")

    @password_selector.setter
    def password_selector(self, value: Optional[str]) -> None:
        self._set_selenium_value("password_selector", value)

    @property
    def login_button_selector(self) -> Optional[str]:
        return self._get_selenium_value("login_button_selector")

    @login_button_selector.setter
    def login_button_selector(self, value: Optional[str]) -> None:
        self._set_selenium_value("login_button_selector", value)

    @property
    def post_login_selector(self) -> Optional[str]:
        return self._get_selenium_value("post_login_selector")

    @post_login_selector.setter
    def post_login_selector(self, value: Optional[str]) -> None:
        self._set_selenium_value("post_login_selector", value)

    @property
    def cookies_to_store(self) -> List[str]:
        return list(self._get_selenium_value("cookies_to_store") or [])

    @cookies_to_store.setter
    def cookies_to_store(self, value: Optional[List[str]]) -> None:
        self._set_selenium_value("cookies_to_store", value or [])


class SiteSetting(SQLModel, table=True):
    __tablename__ = "site_settings"

    key: str = Field(
        sa_column=Column(String(length=255), nullable=False, primary_key=True)
    )
    value: Dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    updated_by_user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )


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
    site_login_credential_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
        ),
    )


class Credential(SQLModel, table=True):
    __tablename__ = "credential"
    __table_args__ = (
        CheckConstraint(
            "(kind <> 'site_login') OR (site_config_id IS NOT NULL)",
            name="ck_credential_site_login_site_config",
        ),
    )
    id: str = Field(default_factory=lambda: gen_id("cred"), primary_key=True)
    kind: str  # instapaper|miniflux|site_login|substack
    description: str = Field(sa_column=Column(String(length=200), nullable=False))
    data: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    owner_user_id: Optional[str] = Field(default=None, index=True)
    site_config_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            ForeignKey("siteconfig.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )


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


class JobSchedule(SQLModel, table=True):
    __tablename__ = "job_schedule"

    id: str = Field(default_factory=lambda: gen_id("js"), primary_key=True)
    job_type: str = Field(
        sa_column=Column(String(length=255), nullable=False, index=True)
    )
    owner_user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String, nullable=True, index=True),
    )
    payload: Dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    frequency: str = Field(sa_column=Column(String(length=255), nullable=False))
    next_run_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True, index=True),
    )
    last_run_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_job_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    last_error: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    last_error_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, index=True),
    )


class Cookie(SQLModel, table=True):
    __tablename__ = "cookie"
    __table_args__ = (
        UniqueConstraint(
            "site_config_id",
            "credential_id",
            name="uq_cookie_site_config_credential",
        ),
    )

    id: str = Field(default_factory=lambda: gen_id("cookie"), primary_key=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    credential_id: str = Field(
        sa_column=Column(
            ForeignKey("credential.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    site_config_id: str = Field(
        sa_column=Column(
            ForeignKey("siteconfig.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    encrypted_cookies: str = Field(sa_column=Column(Text, nullable=False))
    last_refresh: Optional[str] = None  # ISO timestamp
    expiry_hint: Optional[float] = None  # earliest expiry epoch among required cookies


class Bookmark(SQLModel, table=True):
    __tablename__ = "bookmark"
    id: str = Field(default_factory=lambda: gen_id("bm"), primary_key=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    instapaper_bookmark_id: Optional[str] = Field(default=None, index=True)
    url: Optional[str] = None
    title: Optional[str] = None
    content_location: Optional[str] = None
    feed_id: Optional[str] = Field(default=None, index=True)
    published_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    rss_entry: Dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    raw_html_content: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    publication_statuses: Dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    publication_flags: Dict = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )


class Tag(SQLModel, table=True):
    __tablename__ = "tag"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_tag_owner_name"),
    )

    id: str = Field(default_factory=lambda: gen_id("tag"), primary_key=True)
    owner_user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    name: str = Field(index=True)


class Folder(SQLModel, table=True):
    __tablename__ = "folder"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_folder_owner_name"),
    )

    id: str = Field(default_factory=lambda: gen_id("fld"), primary_key=True)
    owner_user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    name: str = Field(index=True)
    instapaper_folder_id: Optional[str] = Field(default=None, index=True)


class BookmarkTagLink(SQLModel, table=True):
    __tablename__ = "bookmark_tag_link"

    bookmark_id: str = Field(
        sa_column=Column(
            ForeignKey("bookmark.id", ondelete="CASCADE"), primary_key=True
        )
    )
    tag_id: str = Field(
        sa_column=Column(
            ForeignKey("tag.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )


class BookmarkFolderLink(SQLModel, table=True):
    __tablename__ = "bookmark_folder_link"

    bookmark_id: str = Field(
        sa_column=Column(
            ForeignKey("bookmark.id", ondelete="CASCADE"), primary_key=True
        )
    )
    folder_id: str = Field(
        sa_column=Column(
            ForeignKey("folder.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: str = Field(default_factory=lambda: gen_id("alog"), primary_key=True)
    entity_type: str = Field(index=True)
    entity_id: str = Field(index=True)
    action: str = Field(index=True)
    owner_user_id: Optional[str] = Field(default=None, index=True)
    actor_user_id: Optional[str] = Field(default=None, index=True)
    details: Dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )


__all__ = [
    "gen_id",
    "User",
    "Organization",
    "OrganizationMembership",
    "Role",
    "UserRole",
    "ApiToken",
    "SiteConfig",
    "SiteSetting",
    "Feed",
    "Credential",
    "Job",
    "Cookie",
    "Bookmark",
    "Tag",
    "Folder",
    "BookmarkTagLink",
    "BookmarkFolderLink",
    "AuditLog",
]
