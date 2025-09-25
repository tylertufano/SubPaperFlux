from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, constr, field_validator, model_validator
from pydantic_core import PydanticCustomError

from .jobs.scheduler import parse_frequency
from .jobs.validation import validate_job


class User(BaseModel):
    sub: str
    email: Optional[str] = None
    name: Optional[str] = None
    groups: List[str] = Field(default_factory=list)


class MeNotificationPreferences(BaseModel):
    email_job_updates: bool = True
    email_digest: bool = False


class MeNotificationPreferencesUpdate(BaseModel):
    email_job_updates: Optional[bool] = None
    email_digest: Optional[bool] = None


class MeOut(BaseModel):
    id: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    picture_url: Optional[str] = None
    locale: Optional[str] = None
    notification_preferences: MeNotificationPreferences


class MeUpdate(BaseModel):
    locale: Optional[str] = Field(default=None, min_length=2, max_length=32)
    notification_preferences: Optional[MeNotificationPreferencesUpdate] = None


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
    description: constr(strip_whitespace=True, min_length=1, max_length=200)
    data: dict  # Placeholder; to be encrypted at rest in a real impl
    owner_user_id: Optional[str] = None
    site_config_id: Optional[str] = None


class JobRequest(BaseModel):
    type: str  # login|miniflux_refresh|rss_poll|publish|retention
    payload: dict


class StatusResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"


class SiteWelcomeContent(BaseModel):
    model_config = ConfigDict(extra="allow")

    headline: Optional[str] = None
    subheadline: Optional[str] = None
    body: Optional[str] = None
    cta_text: Optional[str] = None
    cta_url: Optional[str] = None


class SiteWelcomeSettingOut(BaseModel):
    key: str
    value: SiteWelcomeContent
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    updated_by_user_id: Optional[str] = None


class SiteWelcomeSettingUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    headline: Optional[str] = None
    subheadline: Optional[str] = None
    body: Optional[str] = None
    cta_text: Optional[str] = None
    cta_url: Optional[str] = None


class BookmarkOut(BaseModel):
    id: str
    instapaper_bookmark_id: str
    title: Optional[str] = None
    url: Optional[str] = None
    content_location: Optional[str] = None
    feed_id: Optional[str] = None
    published_at: Optional[str] = None
    rss_entry: Dict[str, Any] = Field(default_factory=dict)
    raw_html_content: Optional[str] = None
    publication_statuses: Dict[str, Any] = Field(default_factory=dict)


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


class JobScheduleCreate(BaseModel):
    job_type: constr(strip_whitespace=True, min_length=1)
    payload: Dict[str, Any] = Field(default_factory=dict)
    frequency: constr(strip_whitespace=True, min_length=1)
    next_run_at: Optional[datetime] = None
    is_active: bool = True
    owner_user_id: Optional[str] = None

    @field_validator("frequency")
    @classmethod
    def _validate_frequency(cls, value: str) -> str:
        parse_frequency(value)
        return value

    @model_validator(mode="after")
    def _validate_payload(self) -> "JobScheduleCreate":
        result = validate_job(self.job_type, self.payload or {})
        if not result.get("ok", True):
            missing_values = result.get("missing", [])
            raise PydanticCustomError(
                "job_payload_missing_fields",
                "Missing payload fields: {missing}",
                {"missing": ", ".join(missing_values)},
            )
        return self


class JobScheduleUpdate(BaseModel):
    job_type: Optional[constr(strip_whitespace=True, min_length=1)] = None
    payload: Optional[Dict[str, Any]] = None
    frequency: Optional[constr(strip_whitespace=True, min_length=1)] = None
    next_run_at: Optional[datetime] = None
    is_active: Optional[bool] = None

    @field_validator("frequency")
    @classmethod
    def _validate_frequency(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            parse_frequency(value)
        return value

    @model_validator(mode="after")
    def _validate_payload(self) -> "JobScheduleUpdate":
        provided_job_type = self.job_type
        provided_payload = self.payload
        if provided_job_type is None and provided_payload is None:
            return self
        if provided_job_type is None or provided_payload is None:
            raise PydanticCustomError(
                "job_payload_requires_job_type",
                "job_type and payload must be provided together when updating the payload",
                {},
            )
        result = validate_job(provided_job_type, provided_payload or {})
        if not result.get("ok", True):
            missing_values = result.get("missing", [])
            raise PydanticCustomError(
                "job_payload_missing_fields",
                "Missing payload fields: {missing}",
                {"missing": ", ".join(missing_values)},
            )
        return self


class JobScheduleOut(BaseModel):
    id: str
    job_type: str
    owner_user_id: Optional[str] = None
    payload: Dict[str, Any]
    frequency: str
    next_run_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    last_job_id: Optional[str] = None
    last_error: Optional[str] = None
    last_error_at: Optional[datetime] = None
    is_active: bool = True


class JobSchedulesPage(BaseModel):
    items: List[JobScheduleOut]
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


class BulkBookmarkTagUpdate(BaseModel):
    bookmark_ids: List[UUID] = Field(..., min_length=1)
    tags: List[str] = Field(default_factory=list)
    clear: bool = False


class BookmarkTagSummary(BaseModel):
    bookmark_id: str
    tags: List[TagOut] = Field(default_factory=list)


class BookmarkFolderUpdate(BaseModel):
    folder_id: Optional[str] = None
    folder_name: Optional[str] = Field(default=None, min_length=1)
    instapaper_folder_id: Optional[str] = None


class BulkBookmarkFolderUpdate(BaseModel):
    bookmark_ids: List[UUID] = Field(..., min_length=1)
    folder_id: Optional[str] = None
    instapaper_folder_id: Optional[str] = None


class BookmarkFolderSummary(BaseModel):
    bookmark_id: str
    folder: Optional[FolderOut] = None


class AuditLogOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    action: str
    owner_user_id: Optional[str] = None
    actor_user_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AuditLogsPage(BaseModel):
    items: List[AuditLogOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class RoleGrantRequest(BaseModel):
    description: Optional[str] = None
    create_missing: bool = False
    is_system: Optional[bool] = None


class AdminRoleListItem(BaseModel):
    id: str
    name: constr(strip_whitespace=True, min_length=2, max_length=64)
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=512)] = None
    is_system: bool = False
    created_at: datetime
    updated_at: datetime
    assigned_user_count: int = Field(default=0, ge=0)


class AdminRoleDetail(AdminRoleListItem):
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AdminRolesPage(BaseModel):
    items: List[AdminRoleListItem]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class AdminRoleCreate(BaseModel):
    name: constr(strip_whitespace=True, min_length=2, max_length=64)
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=512)] = None
    is_system: Optional[bool] = Field(default=None)


class AdminRoleUpdate(BaseModel):
    name: Optional[constr(strip_whitespace=True, min_length=2, max_length=64)] = None
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=512)] = None


class AdminOrganization(BaseModel):
    id: str
    slug: constr(strip_whitespace=True, min_length=2, max_length=255)
    name: constr(strip_whitespace=True, min_length=2, max_length=255)
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=4096)] = None
    is_default: bool = False
    created_at: datetime
    updated_at: datetime
    member_count: int = Field(default=0, ge=0)


class AdminOrganizationMember(BaseModel):
    id: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    joined_at: datetime


class AdminOrganizationDetail(AdminOrganization):
    members: List[AdminOrganizationMember] = Field(default_factory=list)


class AdminOrganizationsPage(BaseModel):
    items: List[AdminOrganization]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class AdminOrganizationCreate(BaseModel):
    slug: constr(
        strip_whitespace=True,
        min_length=2,
        max_length=255,
        pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$",
    )
    name: constr(strip_whitespace=True, min_length=2, max_length=255)
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=4096)] = None
    is_default: Optional[bool] = None


class AdminOrganizationUpdate(BaseModel):
    slug: Optional[
        constr(
            strip_whitespace=True,
            min_length=2,
            max_length=255,
            pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$",
        )
    ] = None
    name: Optional[constr(strip_whitespace=True, min_length=2, max_length=255)] = None
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=4096)] = None
    is_default: Optional[bool] = None


class AdminOrganizationMembershipChange(BaseModel):
    user_id: constr(strip_whitespace=True, min_length=1, max_length=255)


class AdminUserOrganization(BaseModel):
    id: str
    slug: constr(strip_whitespace=True, min_length=2, max_length=255)
    name: constr(strip_whitespace=True, min_length=2, max_length=255)
    description: Optional[constr(strip_whitespace=True, min_length=1, max_length=4096)] = None
    is_default: bool = False
    joined_at: datetime


class AdminUserOrganizationMembership(BaseModel):
    organization_id: str
    organization_slug: constr(strip_whitespace=True, min_length=2, max_length=255)
    organization_name: constr(strip_whitespace=True, min_length=2, max_length=255)
    organization_description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=4096)
    ] = None
    organization_is_default: bool = False
    joined_at: datetime


class AdminUserRoleOverrides(BaseModel):
    enabled: bool = False
    preserve: List[str] = Field(default_factory=list)
    suppress: List[str] = Field(default_factory=list)


class AdminUserOut(BaseModel):
    id: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    picture_url: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: Optional[datetime] = None
    groups: List[str] = Field(default_factory=list)
    roles: List[str] = Field(default_factory=list)
    is_admin: bool = False
    quota_credentials: Optional[int] = Field(default=None, ge=0)
    quota_site_configs: Optional[int] = Field(default=None, ge=0)
    quota_feeds: Optional[int] = Field(default=None, ge=0)
    quota_api_tokens: Optional[int] = Field(default=None, ge=0)
    role_overrides: AdminUserRoleOverrides = Field(default_factory=AdminUserRoleOverrides)
    organization_ids: List[str] = Field(default_factory=list)
    organization_memberships: List[AdminUserOrganizationMembership] = Field(
        default_factory=list
    )
    organizations: List[AdminUserOrganization] = Field(default_factory=list)


class AdminUsersPage(BaseModel):
    items: List[AdminUserOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class AdminUserUpdate(BaseModel):
    is_active: Optional[bool] = None
    confirm: Optional[bool] = None
    quota_credentials: Optional[int] = Field(default=None, ge=0)
    quota_site_configs: Optional[int] = Field(default=None, ge=0)
    quota_feeds: Optional[int] = Field(default=None, ge=0)
    quota_api_tokens: Optional[int] = Field(default=None, ge=0)


class AdminUserRoleOverridesUpdate(BaseModel):
    enabled: Optional[bool] = None
    preserve: Optional[List[str]] = None
    suppress: Optional[List[str]] = None


class ApiTokenCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    expires_at: Optional[datetime] = None


class ApiTokenOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class ApiTokenWithSecret(ApiTokenOut):
    token: str


class ApiTokensPage(BaseModel):
    items: List[ApiTokenOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1
