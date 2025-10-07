from datetime import datetime
from typing import Annotated, Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import (
    AliasChoices,
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    constr,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from .jobs.scheduler import parse_frequency
from .jobs.validation import scrub_legacy_schedule_payload, validate_job


def _merge_site_login_pair_from_fields(model: Any, payload: Dict[str, Any]) -> None:
    base_payload = dict(getattr(model, "payload", {}) or {})
    existing_raw = base_payload.get("site_login_pair")
    existing_pair = ""
    if existing_raw not in (None, ""):
        existing_pair = str(existing_raw).strip()

    raw_credential = getattr(model, "site_login_credential_id", None)
    raw_config = getattr(model, "site_login_config_id", None)
    credential = ""
    config = ""
    if raw_credential not in (None, ""):
        credential = str(raw_credential).strip()
    if raw_config not in (None, ""):
        config = str(raw_config).strip()

    pair_value = existing_pair
    if credential or config:
        if not credential or not config:
            raise PydanticCustomError(
                "site_login_pair_fields_incomplete",
                "site_login_credential_id and site_login_config_id must both be provided when specifying a site login pair.",
            )
        computed_pair = f"{credential}::{config}"
        if existing_pair and existing_pair != computed_pair:
            raise PydanticCustomError(
                "site_login_pair_conflict",
                "site_login_pair conflicts with provided site login identifiers.",
            )
        pair_value = computed_pair

    if pair_value:
        payload["site_login_pair"] = pair_value
        base_payload["site_login_pair"] = pair_value
        object.__setattr__(model, "payload", base_payload)

    object.__setattr__(model, "site_login_credential_id", None)
    object.__setattr__(model, "site_login_config_id", None)

    fields_set = set(getattr(model, "__pydantic_fields_set__", set()))
    if pair_value:
        fields_set.add("payload")
    fields_set.discard("site_login_credential_id")
    fields_set.discard("site_login_config_id")
    object.__setattr__(model, "__pydantic_fields_set__", fields_set)


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


class SeleniumConfig(BaseModel):
    username_selector: str
    password_selector: str
    login_button_selector: str
    post_login_selector: Optional[str] = None
    cookies_to_store: List[str] = Field(default_factory=list)


class ApiConfig(BaseModel):
    endpoint: AnyHttpUrl
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[Dict[str, Any]] = None
    cookies: Dict[str, str] = Field(default_factory=dict)


class SiteConfigBase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    site_url: AnyHttpUrl
    owner_user_id: constr(strip_whitespace=True, min_length=1)
    success_text_class: str = ""
    expected_success_text: str = ""
    required_cookies: List[str] = Field(default_factory=list)


class SiteConfigCreateBase(SiteConfigBase):
    id: Optional[str] = None


class SiteConfigSelenium(SiteConfigCreateBase):
    login_type: Literal["selenium"] = "selenium"
    selenium_config: SeleniumConfig


class SiteConfigApi(SiteConfigCreateBase):
    login_type: Literal["api"] = "api"
    api_config: ApiConfig


SiteConfig = Annotated[Union[SiteConfigSelenium, SiteConfigApi], Field(discriminator="login_type")]


def _validate_tag_id_sequence(raw_value: Any) -> List[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, (str, bytes)):
        raise PydanticCustomError(
            "tag_ids_type",
            "tag_ids must be provided as an ordered list of identifiers",
        )
    try:
        iterator = iter(raw_value)
    except TypeError as exc:  # pragma: no cover - defensive
        raise PydanticCustomError(
            "tag_ids_type",
            "tag_ids must be provided as an ordered list of identifiers",
        ) from exc

    seen: set[str] = set()
    normalized: List[str] = []
    for value in iterator:
        text = str(value).strip()
        if not text:
            raise PydanticCustomError(
                "tag_ids_blank",
                "tag_ids may not contain blank identifiers",
            )
        if text in seen:
            raise PydanticCustomError(
                "tag_ids_duplicates",
                "tag_ids may not contain duplicate identifiers",
            )
        seen.add(text)
        normalized.append(text)
    return normalized


class Feed(BaseModel):
    id: Optional[str] = None
    url: AnyHttpUrl
    poll_frequency: str = "1h"
    initial_lookback_period: Optional[str] = None
    is_paywalled: bool = False
    rss_requires_auth: bool = False
    site_config_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    site_login_credential_id: Optional[str] = None
    folder_id: Optional[str] = None
    tag_ids: List[str] = Field(default_factory=list)
    last_rss_poll_at: Optional[datetime] = None

    @field_validator("tag_ids", mode="before")
    @classmethod
    def _validate_tag_ids(cls, value: Any) -> List[str]:
        return _validate_tag_id_sequence(value)

    @model_validator(mode="after")
    def _normalize_lookback(self) -> "Feed":
        lookback = self.initial_lookback_period
        if isinstance(lookback, str):
            normalized = lookback.strip()
            self.initial_lookback_period = normalized or None
        return self


class Credential(BaseModel):
    id: Optional[str] = None
    kind: str  # instapaper|miniflux|site_login|substack
    description: constr(strip_whitespace=True, min_length=1, max_length=200)
    data: dict  # Placeholder; to be encrypted at rest in a real impl
    owner_user_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("owner_user_id", "ownerUserId"),
    )
    site_config_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("site_config_id", "siteConfigId"),
    )

    @model_validator(mode="after")
    def _validate_site_config(self) -> "Credential":
        if self.kind == "site_login" and not self.site_config_id:
            raise PydanticCustomError(
                "site_login_site_config_required",
                "site_login credentials require a site_config_id",
            )
        return self


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
    instapaper_bookmark_id: Optional[str] = None
    title: Optional[str] = None
    url: Optional[str] = None
    content_location: Optional[str] = None
    feed_id: Optional[str] = None
    published_at: Optional[str] = None
    rss_entry: Dict[str, Any] = Field(default_factory=dict)
    raw_html_content: Optional[str] = None
    publication_statuses: Dict[str, Any] = Field(default_factory=dict)
    publication_flags: Dict[str, Any] = Field(default_factory=dict)


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
    created_at: datetime
    run_at: Optional[datetime] = None
    schedule_id: Optional[str] = None
    schedule_name: Optional[str] = None


class JobsPage(BaseModel):
    items: List[JobOut]
    total: int
    page: int
    size: int
    has_next: bool = False
    total_pages: int = 1


class JobScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_name: constr(strip_whitespace=True, min_length=1, max_length=255)
    job_type: constr(strip_whitespace=True, min_length=1)
    payload: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    folder_id: Optional[str] = None
    site_login_credential_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "site_login_credential_id", "siteLoginCredentialId"
        ),
    )
    site_login_config_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "site_login_config_id", "siteLoginConfigId"
        ),
    )
    frequency: constr(strip_whitespace=True, min_length=1)
    next_run_at: Optional[datetime] = None
    is_active: bool = True

    @model_validator(mode="before")
    @classmethod
    def _reject_owner_user_id(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in ("owner_user_id", "ownerUserId"):
                if key in data:
                    raise PydanticCustomError(
                        "job_schedule_owner_scope_removed",
                        "owner_user_id is no longer accepted; schedules are scoped to the authenticated user.",
                    )
        return data

    @field_validator("tags", mode="before")
    @classmethod
    def _validate_tags(cls, value: Any) -> List[str]:
        return _validate_tag_id_sequence(value)

    @field_validator("frequency")
    @classmethod
    def _validate_frequency(cls, value: str) -> str:
        parse_frequency(value)
        return value

    @model_validator(mode="after")
    def _validate_payload(self) -> "JobScheduleCreate":
        combined_payload = dict(self.payload or {})
        _merge_site_login_pair_from_fields(self, combined_payload)
        if self.tags is not None:
            combined_payload["tags"] = self.tags
        if self.folder_id is not None or "folder_id" in combined_payload:
            combined_payload["folder_id"] = self.folder_id
        result = validate_job(self.job_type, combined_payload)
        if not result.get("ok", True):
            missing_values = result.get("missing", [])
            raise PydanticCustomError(
                "job_payload_missing_fields",
                "Missing payload fields: {missing}",
                {"missing": ", ".join(missing_values)},
            )
        object.__setattr__(
            self,
            "payload",
            scrub_legacy_schedule_payload(self.payload),
        )
        return self


class JobScheduleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_name: Optional[constr(strip_whitespace=True, min_length=1, max_length=255)] = None
    job_type: Optional[constr(strip_whitespace=True, min_length=1)] = None
    payload: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    folder_id: Optional[str] = None
    site_login_credential_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "site_login_credential_id", "siteLoginCredentialId"
        ),
    )
    site_login_config_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "site_login_config_id", "siteLoginConfigId"
        ),
    )
    frequency: Optional[constr(strip_whitespace=True, min_length=1)] = None
    next_run_at: Optional[datetime] = None
    is_active: Optional[bool] = None

    @model_validator(mode="before")
    @classmethod
    def _reject_owner_user_id(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in ("owner_user_id", "ownerUserId"):
                if key in data:
                    raise PydanticCustomError(
                        "job_schedule_owner_scope_removed",
                        "owner_user_id is no longer accepted; schedules are scoped to the authenticated user.",
                    )
        return data

    @field_validator("tags", mode="before")
    @classmethod
    def _validate_tags(cls, value: Any) -> Optional[List[str]]:
        if value is None:
            return None
        return _validate_tag_id_sequence(value)

    @field_validator("frequency")
    @classmethod
    def _validate_frequency(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            parse_frequency(value)
        return value

    @model_validator(mode="after")
    def _validate_payload(self) -> "JobScheduleUpdate":
        provided_job_type = self.job_type
        combined_payload = dict(self.payload or {})
        _merge_site_login_pair_from_fields(self, combined_payload)
        if self.tags is not None:
            combined_payload["tags"] = self.tags
        if self.folder_id is not None or "folder_id" in combined_payload:
            combined_payload["folder_id"] = self.folder_id
        if provided_job_type is not None:
            result = validate_job(provided_job_type, combined_payload)
            if not result.get("ok", True):
                missing_values = result.get("missing", [])
                raise PydanticCustomError(
                    "job_payload_missing_fields",
                    "Missing payload fields: {missing}",
                    {"missing": ", ".join(missing_values)},
                )
        if self.payload is not None:
            object.__setattr__(
                self,
                "payload",
                scrub_legacy_schedule_payload(self.payload),
            )
        return self


class JobScheduleOut(BaseModel):
    id: str
    schedule_name: str
    job_type: str
    payload: Dict[str, Any]
    tags: List[str] = Field(default_factory=list)
    folder_id: Optional[str] = None
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


class SiteConfigOutBase(SiteConfigBase):
    model_config = ConfigDict(extra="ignore")

    id: str


class SiteConfigSeleniumOut(SiteConfigOutBase):
    login_type: Literal["selenium"] = "selenium"
    selenium_config: SeleniumConfig


class SiteConfigApiOut(SiteConfigOutBase):
    login_type: Literal["api"] = "api"
    api_config: ApiConfig


SiteConfigOut = Annotated[
    Union[SiteConfigSeleniumOut, SiteConfigApiOut],
    Field(discriminator="login_type"),
]


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
    site_login_credential_id: Optional[str] = None
    folder_id: Optional[str] = None
    tag_ids: List[str] = Field(default_factory=list)
    last_rss_poll_at: Optional[datetime] = None

    @field_validator("tag_ids", mode="before")
    @classmethod
    def _validate_tag_ids(cls, value: Any) -> List[str]:
        return _validate_tag_id_sequence(value)


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
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=512)
    ] = None
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
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=512)
    ] = None
    is_system: Optional[bool] = Field(default=None)


class AdminRoleUpdate(BaseModel):
    name: Optional[constr(strip_whitespace=True, min_length=2, max_length=64)] = None
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=512)
    ] = None


class AdminOrganization(BaseModel):
    id: str
    slug: constr(strip_whitespace=True, min_length=2, max_length=255)
    name: constr(strip_whitespace=True, min_length=2, max_length=255)
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=4096)
    ] = None
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
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=4096)
    ] = None
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
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=4096)
    ] = None
    is_default: Optional[bool] = None


class AdminOrganizationMembershipChange(BaseModel):
    user_id: constr(strip_whitespace=True, min_length=1, max_length=255)


class AdminUserOrganization(BaseModel):
    id: str
    slug: constr(strip_whitespace=True, min_length=2, max_length=255)
    name: constr(strip_whitespace=True, min_length=2, max_length=255)
    description: Optional[
        constr(strip_whitespace=True, min_length=1, max_length=4096)
    ] = None
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
    role_overrides: AdminUserRoleOverrides = Field(
        default_factory=AdminUserRoleOverrides
    )
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
