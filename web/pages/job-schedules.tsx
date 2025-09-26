import React, { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { Alert, Breadcrumbs, EmptyState, Nav } from "../components";
import { useI18n } from "../lib/i18n";
import { buildBreadcrumbs } from "../lib/breadcrumbs";
import { v1 } from "../lib/openapi";
import {
  extractPermissionList,
  hasPermission,
  PERMISSION_MANAGE_BOOKMARKS,
  PERMISSION_READ_BOOKMARKS,
} from "../lib/rbac";
import type { JobScheduleOut } from "../sdk/src/models/JobScheduleOut";
import type { Credential } from "../sdk/src/models/Credential";
import type { SiteConfigsPageItemsInner } from "../sdk/src/models/SiteConfigsPageItemsInner";
import type { FeedOut } from "../sdk/src/models/FeedOut";
import type { JobSchedulesPage } from "../sdk/src/models/JobSchedulesPage";
import { useDateTimeFormatter, useNumberFormatter } from "../lib/format";
import { buildSiteLoginOptions, SiteLoginOption } from "../lib/siteLoginOptions";
type JobType =
  | "login"
  | "miniflux_refresh"
  | "rss_poll"
  | "publish"
  | "retention";
type OwnerFilter = "me" | "global" | "all";
type ActiveFilter = "all" | "active" | "paused";
type OwnerScope = "self" | "global";

type ScheduleFormResult = {
  jobType: JobType;
  frequency: string;
  payload: Record<string, any>;
  nextRunAt: Date | null;
  isActive: boolean;
  ownerUserId?: string | null;
};

type ScheduleFormMode = "create" | "edit";

type SiteLoginSelection = {
  credentialId: string;
  siteConfigId: string;
};

type ExtendedJobSchedule = JobScheduleOut & {
  lastError?: string | null;
  lastErrorAt?: Date | null;
};

type ScheduleFormProps = {
  mode: ScheduleFormMode;
  initialSchedule?: ExtendedJobSchedule;
  credentials: Credential[];
  siteConfigs: SiteConfigsPageItemsInner[];
  feeds: FeedOut[];
  onSubmit: (values: ScheduleFormResult) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  allowOwnerSelection: boolean;
};

const PAGE_SIZE = 20;
const DEFAULT_JOB_TYPE: JobType = "rss_poll";
const JOB_TYPES: JobType[] = [
  "login",
  "miniflux_refresh",
  "rss_poll",
  "publish",
  "retention",
];

function toSiteLoginKey({
  credentialId,
  siteConfigId,
}: SiteLoginSelection): string {
  return `${credentialId}::${siteConfigId}`;
}

function parseSiteLoginKey(
  value: string | null | undefined,
): SiteLoginSelection | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith("pair:")
    ? trimmed.slice("pair:".length)
    : trimmed;
  const [credentialIdRaw, siteConfigIdRaw] = withoutPrefix.split("::");
  const credentialId = credentialIdRaw?.trim();
  const siteConfigId = siteConfigIdRaw?.trim();
  if (!credentialId || !siteConfigId) return null;
  return { credentialId, siteConfigId };
}

function extractSiteLoginPair(
  payload?: Record<string, any> | null,
): string {
  if (!payload) return "";
  const credentialCandidate =
    payload?.credential_id ??
    payload?.credentialId ??
    payload?.credential;
  const siteConfigCandidate =
    payload?.site_config_id ??
    payload?.siteConfigId ??
    payload?.site_config;
  const credentialId =
    credentialCandidate != null ? String(credentialCandidate).trim() : "";
  const siteConfigId =
    siteConfigCandidate != null ? String(siteConfigCandidate).trim() : "";
  if (credentialId && siteConfigId) {
    return toSiteLoginKey({ credentialId, siteConfigId });
  }
  const rawPair =
    payload?.site_login_pair ??
    payload?.siteLoginPair ??
    null;
  if (typeof rawPair === "string") {
    const parsed = parseSiteLoginKey(rawPair);
    if (parsed) {
      return toSiteLoginKey(parsed);
    }
    const trimmedPair = rawPair.trim();
    return trimmedPair;
  }
  return "";
}

function toDateTimeLocalValue(value?: Date | null): string {
  if (!value) return "";
  const pad = (input: number) => input.toString().padStart(2, "0");
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hours = pad(value.getHours());
  const minutes = pad(value.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parseDateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

type RawJobSchedule = JobScheduleOut & {
  job_type?: string;
};

function normalizeJobSchedule(schedule: RawJobSchedule): ExtendedJobSchedule {
  const jobType = schedule.jobType ?? schedule.job_type;
  return {
    ...schedule,
    jobType: jobType as JobType | undefined,
    nextRunAt: parseDateValue(schedule.nextRunAt),
    lastRunAt: parseDateValue(schedule.lastRunAt),
    lastErrorAt: parseDateValue(schedule.lastErrorAt),
  };
}

function initPayloadState(
  jobType: JobType,
  payload?: Record<string, any> | null,
): Record<string, any> {
  const initialSiteLoginPair = extractSiteLoginPair(payload);
  switch (jobType) {
    case "login":
      return {
        site_login_pair: initialSiteLoginPair,
      };
    case "miniflux_refresh":
      return {
        miniflux_id: payload?.miniflux_id ?? "",
        feed_ids: Array.isArray(payload?.feed_ids)
          ? payload.feed_ids.map((value: any) => String(value))
          : [],
        site_login_pair: initialSiteLoginPair,
      };
    case "rss_poll":
      return {
        feed_id: payload?.feed_id ?? "",
        lookback: payload?.lookback ?? "",
        is_paywalled: Boolean(payload?.is_paywalled ?? false),
        rss_requires_auth: Boolean(payload?.rss_requires_auth ?? false),
        site_login_pair: initialSiteLoginPair,
      };
    case "publish":
      return {
        instapaper_id: payload?.instapaper_id ?? "",
        feed_id: payload?.feed_id ?? "",
      };
    case "retention":
      return {
        instapaper_credential_id:
          payload?.instapaper_credential_id ?? payload?.instapaper_id ?? "",
        older_than: payload?.older_than ?? "",
        feed_id: payload?.feed_id ?? "",
      };
    default:
      return {};
  }
}

function defaultFrequency(jobType: JobType): string {
  if (jobType === "retention") return "1d";
  if (jobType === "publish") return "15m";
  return "1h";
}

function jobTypeLabel(
  jobType: JobType | undefined,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (!jobType) {
    return t("job_type_unknown");
  }
  if (!JOB_TYPES.includes(jobType)) {
    return t("job_type_unknown");
  }
  return t(`job_type_${jobType}`);
}

function ScheduleForm({
  mode,
  initialSchedule,
  credentials,
  siteConfigs,
  feeds,
  onSubmit,
  onCancel,
  isSubmitting,
  allowOwnerSelection,
}: ScheduleFormProps) {
  const { t } = useI18n();
  const initialType = (initialSchedule?.jobType as JobType) ?? DEFAULT_JOB_TYPE;
  const [jobType, setJobType] = useState<JobType>(initialType);
  const [frequency, setFrequency] = useState(
    initialSchedule?.frequency ?? defaultFrequency(initialType),
  );
  const [nextRunAt, setNextRunAt] = useState(() =>
    toDateTimeLocalValue(initialSchedule?.nextRunAt ?? null),
  );
  const [isActive, setIsActive] = useState(initialSchedule?.isActive ?? true);
  const [ownerScope, setOwnerScope] = useState<OwnerScope>(
    initialSchedule
      ? initialSchedule.ownerUserId == null
        ? "global"
        : "self"
      : "self",
  );
  const [payloadState, setPayloadState] = useState<Record<string, any>>(
    initPayloadState(initialType, initialSchedule?.payload),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const nextType = (initialSchedule?.jobType as JobType) ?? DEFAULT_JOB_TYPE;
    setJobType(nextType);
    setFrequency(initialSchedule?.frequency ?? defaultFrequency(nextType));
    setNextRunAt(toDateTimeLocalValue(initialSchedule?.nextRunAt ?? null));
    setIsActive(initialSchedule?.isActive ?? true);
    setOwnerScope(
      initialSchedule
        ? initialSchedule.ownerUserId == null
          ? "global"
          : "self"
        : "self",
    );
    setPayloadState(initPayloadState(nextType, initialSchedule?.payload));
    setErrors({});
    setFormError(null);
  }, [initialSchedule]);

  function handleJobTypeChange(nextType: JobType) {
    setJobType(nextType);
    setPayloadState(initPayloadState(nextType));
    if (!initialSchedule) {
      setFrequency(defaultFrequency(nextType));
    }
    setErrors({});
    setFormError(null);
  }

  function updatePayload(key: string, value: any) {
    setPayloadState((prev) => ({ ...prev, [key]: value }));
  }

  const loginCredentials = useMemo(
    () =>
      credentials.filter(
        (cred): cred is Credential & { id: string } =>
          cred.kind === "site_login" && Boolean(cred.id),
      ),
    [credentials],
  );
  const minifluxCredentials = useMemo(
    () =>
      credentials.filter(
        (cred): cred is Credential & { id: string } =>
          cred.kind === "miniflux" && Boolean(cred.id),
      ),
    [credentials],
  );
  const instapaperCredentials = useMemo(
    () =>
      credentials.filter(
        (cred): cred is Credential & { id: string } =>
          cred.kind === "instapaper" && Boolean(cred.id),
      ),
    [credentials],
  );

  function buildPayload():
    | { ok: true; value: ScheduleFormResult }
    | { ok: false; errors: Record<string, string>; message?: string } {
    const nextErrors: Record<string, string> = {};
    const trimmedFrequency = frequency.trim();
    if (!trimmedFrequency) {
      nextErrors.frequency = t("job_schedules_error_frequency");
    }
    if (!jobType) {
      nextErrors.jobType = t("job_schedules_error_job_type");
    }

    let parsedNextRun: Date | null = null;
    if (nextRunAt) {
      const parsed = fromDateTimeLocalValue(nextRunAt);
      if (!parsed) {
        nextErrors.nextRunAt = t("job_schedules_error_datetime");
      } else {
        parsedNextRun = parsed;
      }
    }

    const payload: Record<string, any> = {};

    if (jobType === "login") {
      const siteLoginValue = (payloadState.site_login_pair || "")
        .toString()
        .trim();
      const siteLogin = parseSiteLoginKey(siteLoginValue);
      if (!siteLogin) {
        nextErrors["payload.site_login_pair"] = t(
          "job_schedules_error_site_login_pair",
        );
      } else {
        payload.site_login_pair = toSiteLoginKey(siteLogin);
      }
    } else if (jobType === "miniflux_refresh") {
      const minifluxId = (payloadState.miniflux_id || "").toString().trim();
      const feedIds: Array<string> = Array.isArray(payloadState.feed_ids)
        ? payloadState.feed_ids
            .map((value: any) => String(value).trim())
            .filter(Boolean)
        : [];
      const siteLoginValue = (payloadState.site_login_pair || "")
        .toString()
        .trim();
      const siteLogin = parseSiteLoginKey(siteLoginValue);
      if (!minifluxId)
        nextErrors["payload.miniflux_id"] = t("job_schedules_error_miniflux");
      if (feedIds.length === 0)
        nextErrors["payload.feed_ids"] = t("job_schedules_error_feed_ids");
      if (!siteLogin)
        nextErrors["payload.site_login_pair"] = t(
          "job_schedules_error_site_login_pair",
        );
      payload.miniflux_id = minifluxId;
      if (feedIds.length > 0) {
        payload.feed_ids = feedIds.map((value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : value;
        });
      }
      if (siteLogin) {
        payload.site_login_pair = toSiteLoginKey(siteLogin);
      }
    } else if (jobType === "rss_poll") {
      const feedId = (payloadState.feed_id || "").toString().trim();
      const lookback = (payloadState.lookback || "").toString().trim();
      const isPaywalled = Boolean(payloadState.is_paywalled);
      const rssRequiresAuth = Boolean(payloadState.rss_requires_auth);
      if (!feedId)
        nextErrors["payload.feed_id"] = t("job_schedules_error_feed_selection");
      const siteLoginValue = (payloadState.site_login_pair || "")
        .toString()
        .trim();
      const siteLogin = parseSiteLoginKey(siteLoginValue);
      if (feedId) payload.feed_id = feedId;
      if (lookback) payload.lookback = lookback;
      payload.is_paywalled = isPaywalled;
      payload.rss_requires_auth = rssRequiresAuth;
      if (siteLogin) {
        payload.site_login_pair = toSiteLoginKey(siteLogin);
      }

    } else if (jobType === "publish") {
      const instapaperId = (payloadState.instapaper_id || "").toString().trim();
      const feedId = (payloadState.feed_id || "").toString().trim();
      if (!instapaperId)
        nextErrors["payload.instapaper_id"] = t(
          "job_schedules_error_instapaper",
        );
      payload.instapaper_id = instapaperId;
      if (!feedId)
        nextErrors["payload.feed_id"] = t(
          "job_schedules_error_feed_selection",
        );
      if (feedId) payload.feed_id = feedId;
    } else if (jobType === "retention") {
      const instapaperId = (
        payloadState.instapaper_credential_id ||
        payloadState.instapaper_id ||
        ""
      )
        .toString()
        .trim();
      const feedId = (payloadState.feed_id || "").toString().trim();
      const olderThan = (payloadState.older_than || "").toString().trim();
      if (!instapaperId)
        nextErrors["payload.instapaper_credential_id"] = t(
          "job_schedules_error_instapaper",
        );
      if (!olderThan)
        nextErrors["payload.older_than"] = t("job_schedules_error_retention");
      if (instapaperId) {
        payload.instapaper_credential_id = instapaperId;
      }
      payload.older_than = olderThan;
      if (feedId) {
        payload.feed_id = feedId;
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      return { ok: false, errors: nextErrors };
    }

    const result: ScheduleFormResult = {
      jobType,
      frequency: trimmedFrequency,
      payload,
      nextRunAt: parsedNextRun,
      isActive,
      ownerUserId: ownerScope === "global" ? null : undefined,
    };

    return { ok: true, value: result };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = buildPayload();
    if (!result.ok) {
      setErrors(result.errors);
      if (result.message) setFormError(result.message);
      return;
    }
    setErrors({});
    setFormError(null);
    await onSubmit(result.value);
  }

  const ownerOptions: Array<{ value: OwnerScope; label: string }> = [
    { value: "self", label: t("job_schedules_owner_self") },
    { value: "global", label: t("job_schedules_owner_global") },
  ];

  const siteLoginOptions: SiteLoginOption[] = useMemo(
    () => buildSiteLoginOptions(loginCredentials, siteConfigs, t("feeds_field_site_config_only")),
    [loginCredentials, siteConfigs, t],
  );

  function renderJobSpecificFields() {
    switch (jobType) {
      case "login":
        return (
          <div className="flex flex-col">
            <label
              className="text-sm font-medium text-gray-700"
              htmlFor="schedule-login-site-login"
            >
              {t("job_schedules_field_site_login_pair")}
            </label>
            <select
              id="schedule-login-site-login"
              className="input"
              value={payloadState.site_login_pair || ""}
              onChange={(e) => updatePayload("site_login_pair", e.target.value)}
              aria-invalid={Boolean(errors["payload.site_login_pair"])}
              aria-describedby={
                errors["payload.site_login_pair"]
                  ? "schedule-login-site-login-error"
                  : undefined
              }
            >
              <option value="">{t("job_schedules_option_select_pair")}</option>
              {siteLoginOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors["payload.site_login_pair"] && (
              <p
                id="schedule-login-site-login-error"
                className="text-sm text-red-600 mt-1"
              >
                {errors["payload.site_login_pair"]}
              </p>
            )}
          </div>
        );
      case "miniflux_refresh":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-credential"
              >
                {t("job_schedules_field_miniflux_credential")}
              </label>
              <select
                id="schedule-miniflux-credential"
                className="input"
                value={payloadState.miniflux_id || ""}
                onChange={(e) => updatePayload("miniflux_id", e.target.value)}
                aria-invalid={Boolean(errors["payload.miniflux_id"])}
                aria-describedby={
                  errors["payload.miniflux_id"]
                    ? "schedule-miniflux-credential-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {minifluxCredentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.description}
                  </option>
                ))}
              </select>
              {errors["payload.miniflux_id"] && (
                <p
                  id="schedule-miniflux-credential-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.miniflux_id"]}
                </p>
              )}
            </div>
            <div className="flex flex-col md:col-span-2">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-feed-select"
              >
                {t("job_schedules_field_miniflux_feeds")}
              </label>
              <select
                id="schedule-miniflux-feed-select"
                className="input h-40"
                multiple
                value={payloadState.feed_ids || []}
                onChange={(e) =>
                  updatePayload(
                    "feed_ids",
                    Array.from(e.target.selectedOptions, (option) => option.value),
                  )
                }
                aria-label={t("job_schedules_field_miniflux_feeds")}
                aria-invalid={Boolean(errors["payload.feed_ids"])}
                aria-describedby={
                  errors["payload.feed_ids"]
                    ? "schedule-miniflux-feed-select-error"
                    : undefined
                }
              >
                {feeds.map((feed) => {
                  const value = String(feed.id ?? feed.url);
                  return (
                    <option key={value} value={value}>
                      {feed.url}
                    </option>
                  );
                })}
              </select>
              <p className="text-sm text-gray-600 mt-1">
                {t("job_schedules_field_miniflux_feeds_help")}
              </p>
              {errors["payload.feed_ids"] && (
                <p
                  id="schedule-miniflux-feed-select-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.feed_ids"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-site-login"
              >
                {t("job_schedules_field_site_login_pair")}
              </label>
              <select
                id="schedule-miniflux-site-login"
                className="input"
                value={payloadState.site_login_pair || ""}
                onChange={(e) => updatePayload("site_login_pair", e.target.value)}
                aria-invalid={Boolean(errors["payload.site_login_pair"])}
                aria-describedby={
                  errors["payload.site_login_pair"]
                    ? "schedule-miniflux-site-login-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select_pair")}</option>
                {siteLoginOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors["payload.site_login_pair"] && (
                <p
                  id="schedule-miniflux-site-login-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.site_login_pair"]}
                </p>
              )}
            </div>
          </div>
        );
      case "rss_poll":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-feed-select"
              >
                {t("job_schedules_field_saved_feed")}
              </label>
              <select
                id="schedule-rss-feed-select"
                className="input"
                value={payloadState.feed_id || ""}
                onChange={(e) => {
                  const value = e.target.value;
                  updatePayload("feed_id", value);
                  const selected = feeds.find((feed) => {
                    const candidateId = feed.id ? String(feed.id) : null;
                    return Boolean(candidateId && candidateId === value);
                  });
                  if (selected) {
                    const selectedWithLegacyFields = selected as FeedOut & {
                      siteConfigId?: string | null;
                      siteLoginCredentialId?: string | null;
                      site_config_id?: string | null;
                      site_login_credential_id?: string | null;
                    };
                    const selectedConfigId =
                      selectedWithLegacyFields.site_config_id ??
                      selectedWithLegacyFields.siteConfigId ??
                      null;
                    const selectedCredentialId =
                      selectedWithLegacyFields.site_login_credential_id ??
                      selectedWithLegacyFields.siteLoginCredentialId ??
                      null;
                    if (selectedConfigId) {
                      const normalizedConfig = String(selectedConfigId);
                      let autoPair = undefined as SiteLoginOption | undefined;
                      if (selectedCredentialId) {
                        const normalizedCredential = String(selectedCredentialId);
                        autoPair = siteLoginOptions.find(
                          (option) =>
                            option.siteConfigId === normalizedConfig &&
                            option.credentialId === normalizedCredential,
                        );
                      }
                      if (!autoPair) {
                        autoPair = siteLoginOptions.find(
                          (option) =>
                            option.siteConfigId === normalizedConfig &&
                            option.type === "pair",
                        );
                      }
                      if (!autoPair) {
                        autoPair = siteLoginOptions.find(
                          (option) => option.siteConfigId === normalizedConfig,
                        );
                      }
                      if (!payloadState.site_login_pair && autoPair) {
                        updatePayload("site_login_pair", autoPair.value);
                      }
                    } else if (payloadState.site_login_pair) {
                      updatePayload("site_login_pair", "");
                    }
                  } else if (payloadState.site_login_pair) {
                    updatePayload("site_login_pair", "");
                  }
                }}
                aria-label={t("job_schedules_field_saved_feed")}
                aria-invalid={Boolean(errors["payload.feed_id"])}
                aria-describedby={
                  errors["payload.feed_id"]
                    ? "schedule-rss-feed-select-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select_feed")}</option>
                {feeds
                  .filter((feed) => feed.id)
                  .map((feed) => {
                    const optionValue = feed.id ? String(feed.id) : "";
                    return (
                      <option key={feed.id ?? feed.url} value={optionValue}>
                        {feed.url}
                      </option>
                    );
                  })}
              </select>
              <p className="text-sm text-gray-600 mt-1">
                {t("job_schedules_field_saved_feed_help")}
              </p>
              {errors["payload.feed_id"] && (
                <p
                  id="schedule-rss-feed-select-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.feed_id"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-lookback"
              >
                {t("job_schedules_field_lookback")}
              </label>
              <input
                id="schedule-rss-lookback"
                className="input"
                value={payloadState.lookback || ""}
                onChange={(e) => updatePayload("lookback", e.target.value)}
              />
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                id="schedule-rss-paywalled"
                type="checkbox"
                checked={Boolean(payloadState.is_paywalled)}
                onChange={(e) => updatePayload("is_paywalled", e.target.checked)}
              />
              <span className="text-sm text-gray-700">
                {t("job_schedules_field_is_paywalled")}
              </span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                id="schedule-rss-requires-auth"
                type="checkbox"
                checked={Boolean(payloadState.rss_requires_auth)}
                onChange={(e) =>
                  updatePayload("rss_requires_auth", e.target.checked)
                }
              />
              <span className="text-sm text-gray-700">
                {t("job_schedules_field_rss_requires_auth")}
              </span>
            </label>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-site-login"
              >
                {t("job_schedules_field_site_login_optional")}
              </label>
              <select
                id="schedule-rss-site-login"
                className="input"
                value={payloadState.site_login_pair || ""}
                onChange={(e) => updatePayload("site_login_pair", e.target.value)}
              >
                <option value="">{t("job_schedules_option_select_pair")}</option>
                {siteLoginOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      case "publish":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-publish-instapaper"
              >
                {t("job_schedules_field_instapaper_credential")}
              </label>
              <select
                id="schedule-publish-instapaper"
                className="input"
                value={payloadState.instapaper_id || ""}
                onChange={(e) => updatePayload("instapaper_id", e.target.value)}
                aria-invalid={Boolean(errors["payload.instapaper_id"])}
                aria-describedby={
                  errors["payload.instapaper_id"]
                    ? "schedule-publish-instapaper-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {instapaperCredentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.description}
                  </option>
                ))}
              </select>
              {errors["payload.instapaper_id"] && (
                <p
                  id="schedule-publish-instapaper-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.instapaper_id"]}
                </p>
              )}
            </div>
            <div className="flex flex-col md:col-span-2">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-publish-feed"
              >
                {t("job_schedules_field_publish_feed")}
              </label>
              <select
                id="schedule-publish-feed"
                className="input"
                value={payloadState.feed_id || ""}
                onChange={(e) => updatePayload("feed_id", e.target.value)}
                aria-invalid={Boolean(errors["payload.feed_id"])}
                aria-describedby={
                  errors["payload.feed_id"]
                    ? "schedule-publish-feed-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {feeds.map((feed) => (
                  <option key={feed.id} value={feed.id}>
                    {feed.url}
                  </option>
                ))}
              </select>
              {errors["payload.feed_id"] && (
                <p
                  id="schedule-publish-feed-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.feed_id"]}
                </p>
              )}
            </div>
          </div>
        );
      case "retention":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-retention-instapaper"
              >
                {t("job_schedules_field_instapaper_credential")}
              </label>
              <select
                id="schedule-retention-instapaper"
                className="input"
                value={payloadState.instapaper_credential_id || ""}
                onChange={(e) =>
                  updatePayload("instapaper_credential_id", e.target.value)
                }
                aria-invalid={
                  Boolean(
                    errors["payload.instapaper_credential_id"] ||
                      errors["payload.instapaper_id"],
                  )
                }
                aria-describedby={
                  errors["payload.instapaper_credential_id"] ||
                  errors["payload.instapaper_id"]
                    ? "schedule-retention-instapaper-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {instapaperCredentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.description}
                  </option>
                ))}
              </select>
              {(errors["payload.instapaper_credential_id"] ||
                errors["payload.instapaper_id"]) && (
                <p
                  id="schedule-retention-instapaper-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {
                    errors["payload.instapaper_credential_id"] ||
                    errors["payload.instapaper_id"]
                  }
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-retention-feed"
              >
                {t("job_schedules_field_retention_feed")}
              </label>
              <select
                id="schedule-retention-feed"
                className="input"
                value={payloadState.feed_id || ""}
                onChange={(e) => updatePayload("feed_id", e.target.value)}
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {feeds.map((feed) => (
                  <option key={feed.id} value={feed.id}>
                    {feed.url}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col md:col-span-2">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-retention-older-than"
              >
                {t("job_schedules_field_retention")}
              </label>
              <input
                id="schedule-retention-older-than"
                className="input"
                value={payloadState.older_than || ""}
                onChange={(e) => updatePayload("older_than", e.target.value)}
                aria-invalid={Boolean(errors["payload.older_than"])}
                aria-describedby={
                  errors["payload.older_than"]
                    ? "schedule-retention-older-than-error"
                    : undefined
                }
              />
              {errors["payload.older_than"] && (
                <p
                  id="schedule-retention-older-than-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.older_than"]}
                </p>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col">
          <label
            className="text-sm font-medium text-gray-700"
            htmlFor="schedule-job-type"
          >
            {t("job_schedules_field_job_type")}
          </label>
          <select
            id="schedule-job-type"
            className="input"
            value={jobType}
            onChange={(e) => handleJobTypeChange(e.target.value as JobType)}
            aria-invalid={Boolean(errors.jobType)}
            aria-describedby={
              errors.jobType ? "schedule-job-type-error" : undefined
            }
          >
            {JOB_TYPES.map((type) => (
              <option key={type} value={type}>
                {jobTypeLabel(type, t)}
              </option>
            ))}
          </select>
          {errors.jobType && (
            <p
              id="schedule-job-type-error"
              className="text-sm text-red-600 mt-1"
            >
              {errors.jobType}
            </p>
          )}
        </div>
        <div className="flex flex-col">
          <label
            className="text-sm font-medium text-gray-700"
            htmlFor="schedule-frequency"
          >
            {t("job_schedules_field_frequency")}
          </label>
          <input
            id="schedule-frequency"
            className="input"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            aria-invalid={Boolean(errors.frequency)}
            aria-describedby={
              errors.frequency ? "schedule-frequency-error" : undefined
            }
          />
          {errors.frequency && (
            <p
              id="schedule-frequency-error"
              className="text-sm text-red-600 mt-1"
            >
              {errors.frequency}
            </p>
          )}
        </div>
        <div className="flex flex-col">
          <label
            className="text-sm font-medium text-gray-700"
            htmlFor="schedule-next-run"
          >
            {t("job_schedules_field_next_run")}
          </label>
          <input
            id="schedule-next-run"
            type="datetime-local"
            className="input"
            value={nextRunAt}
            onChange={(e) => setNextRunAt(e.target.value)}
            aria-invalid={Boolean(errors.nextRunAt)}
            aria-describedby={
              errors.nextRunAt ? "schedule-next-run-error" : undefined
            }
          />
          <p className="text-sm text-gray-600 mt-1">
            {t("job_schedules_field_next_run_help")}
          </p>
          {errors.nextRunAt && (
            <p
              id="schedule-next-run-error"
              className="text-sm text-red-600 mt-1"
            >
              {errors.nextRunAt}
            </p>
          )}
        </div>
        <div className="flex flex-col">
          <label
            className="text-sm font-medium text-gray-700"
            htmlFor="schedule-owner"
          >
            {t("job_schedules_field_owner")}
          </label>
          <select
            id="schedule-owner"
            className="input"
            value={ownerScope}
            onChange={(e) => setOwnerScope(e.target.value as OwnerScope)}
            disabled={!allowOwnerSelection || mode === "edit"}
          >
            {ownerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-sm text-gray-600 mt-1">
            {t("job_schedules_field_owner_help")}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 md:col-span-2">
          <input
            id="schedule-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-sm text-gray-700">
            {t("job_schedules_field_active")}
          </span>
        </label>
      </div>

      <div className="space-y-4">{renderJobSpecificFields()}</div>

      {formError && (
        <Alert
          kind="error"
          message={formError}
          onClose={() => setFormError(null)}
        />
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={Boolean(isSubmitting)}>
          {mode === "edit"
            ? t("job_schedules_btn_update")
            : t("job_schedules_btn_create")}
        </button>
        {mode === "edit" && onCancel ? (
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={Boolean(isSubmitting)}
          >
            {t("job_schedules_btn_cancel_edit")}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export default function JobSchedulesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(router.pathname, t),
    [router.pathname, t],
  );
  const permissions = extractPermissionList(session?.user);
  const isAuthenticated = sessionStatus === "authenticated";
  const canViewSchedules = Boolean(
    isAuthenticated &&
      (hasPermission(permissions, PERMISSION_READ_BOOKMARKS) ||
        hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS)),
  );
  const canManageSchedules = Boolean(
    isAuthenticated && hasPermission(permissions, PERMISSION_MANAGE_BOOKMARKS),
  );

  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("me");
  const [jobTypeFilter, setJobTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [page, setPage] = useState(1);
  const [banner, setBanner] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingSchedule, setEditingSchedule] =
    useState<ExtendedJobSchedule | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    kind: "toggle" | "run" | "delete";
  } | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [ownerFilter, jobTypeFilter, activeFilter]);

  const { data, error, isLoading, mutate } = useSWR<JobSchedulesPage>(
    canViewSchedules
      ? ["/v1/job-schedules", ownerFilter, jobTypeFilter, activeFilter, page]
      : null,
    async ([, owner, jobType, active, currentPage]) => {
      const params: any = { page: currentPage, size: PAGE_SIZE };
      if (owner && owner !== "all") {
        params.ownerUserId = [owner];
      }
      if (jobType) {
        params.jobType = jobType;
      }
      if (active === "active") {
        params.isActive = true;
      } else if (active === "paused") {
        params.isActive = false;
      }
      return v1.listJobSchedulesV1JobSchedulesGet(params);
    },
  );

  const { data: credentialsData } = useSWR(
    canManageSchedules ? ["/v1/credentials", "job-schedules"] : null,
    () => v1.listCredentialsV1V1CredentialsGet({ page: 1, size: 200 }),
  );
  const { data: siteConfigsData } = useSWR(
    canManageSchedules ? ["/v1/site-configs", "job-schedules"] : null,
    () => v1.listSiteConfigsV1V1SiteConfigsGet({ page: 1, size: 200 }),
  );
  const { data: feedsData } = useSWR(
    canManageSchedules ? ["/v1/feeds", "job-schedules"] : null,
    () => v1.listFeedsV1V1FeedsGet({ page: 1, size: 200 }),
  );

  const numberFormatter = useNumberFormatter();
  const dateFormatter = useDateTimeFormatter({
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (sessionStatus === "loading") {
    return (
      <div>
        <Nav />
        <main className="container py-12">
          <p className="text-gray-700">{t("loading_text")}</p>
        </main>
      </div>
    );
  }

  const renderAccessMessage = (title: string, message: string) => (
    <div>
      <Nav />
      <main className="container py-12">
        <div className="max-w-xl space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          <p className="text-gray-700">{message}</p>
        </div>
      </main>
    </div>
  );

  if (sessionStatus === "unauthenticated") {
    return renderAccessMessage(
      t("access_sign_in_title"),
      t("access_sign_in_message"),
    );
  }

  if (!canViewSchedules) {
    return renderAccessMessage(
      t("access_denied_title"),
      t("access_denied_message"),
    );
  }

  const schedules: ExtendedJobSchedule[] = useMemo(
    () => (data?.items ?? []).map((schedule) => normalizeJobSchedule(schedule)),
    [data],
  );
  const credentials = credentialsData?.items ?? [];
  const siteConfigs = siteConfigsData?.items ?? [];
  const feeds = feedsData?.items ?? [];
  const hasNext = Boolean(data?.hasNext);
  const totalPages = data?.totalPages ?? data?.total ?? 1;
  const currentUserId =
    typeof session?.user?.id === "string" ? session.user.id : undefined;

  const formatDateValue = (value?: Date | null) =>
    value ? dateFormatter.format(value) : "—";

  const scopeLabel = (schedule: ExtendedJobSchedule) => {
    if (!schedule.ownerUserId) {
      return t("scope_global");
    }
    if (schedule.ownerUserId === currentUserId) {
      return t("scope_user");
    }
    return schedule.ownerUserId;
  };

  const statusLabel = (schedule: ExtendedJobSchedule) =>
    schedule.isActive
      ? t("job_schedules_status_active")
      : t("job_schedules_status_paused");

  async function handleCreate(values: ScheduleFormResult) {
    setIsCreating(true);
    try {
      await v1.createJobScheduleV1JobSchedulesPost({
        jobScheduleCreate: {
          jobType: values.jobType,
          frequency: values.frequency,
          payload: values.payload,
          nextRunAt: values.nextRunAt ?? undefined,
          isActive: values.isActive,
          ownerUserId: values.ownerUserId,
        },
      });
      setBanner({
        kind: "success",
        message: t("job_schedules_create_success"),
      });
      setExpanded({});
      await mutate();
    } catch (error: any) {
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleUpdate(values: ScheduleFormResult) {
    if (!editingSchedule) return;
    setIsEditing(true);
    try {
      await v1.updateJobScheduleV1JobSchedulesScheduleIdPatch({
        scheduleId: editingSchedule.id,
        jobScheduleUpdate: {
          jobType: values.jobType,
          payload: values.payload,
          frequency: values.frequency,
          nextRunAt: values.nextRunAt === null ? null : values.nextRunAt,
          isActive: values.isActive,
        },
      });
      setBanner({
        kind: "success",
        message: t("job_schedules_update_success"),
      });
      setEditingSchedule(null);
      await mutate();
    } catch (error: any) {
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setIsEditing(false);
    }
  }

  async function handleStartEdit(schedule: ExtendedJobSchedule) {
    setLoadingEditId(schedule.id);
    try {
      const full = await v1.getJobScheduleV1JobSchedulesScheduleIdGet({
        scheduleId: schedule.id,
      });
      setEditingSchedule(normalizeJobSchedule(full));
    } catch (error: any) {
      setEditingSchedule(normalizeJobSchedule(schedule));
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setLoadingEditId(null);
    }
  }

  async function handleToggle(schedule: ExtendedJobSchedule) {
    setPendingAction({ id: schedule.id, kind: "toggle" });
    try {
      const updated =
        await v1.toggleJobScheduleV1JobSchedulesScheduleIdTogglePost({
          scheduleId: schedule.id,
        });
      setBanner({
        kind: "success",
        message: updated.isActive
          ? t("job_schedules_toggle_success_active")
          : t("job_schedules_toggle_success_paused"),
      });
      await mutate();
    } catch (error: any) {
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRunNow(schedule: ExtendedJobSchedule) {
    setPendingAction({ id: schedule.id, kind: "run" });
    try {
      const job = await v1.runJobScheduleNowV1JobSchedulesScheduleIdRunNowPost({
        scheduleId: schedule.id,
      });
      setBanner({
        kind: "success",
        message: t("job_schedules_run_success", { id: job.id }),
      });
      await mutate();
    } catch (error: any) {
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete(schedule: ExtendedJobSchedule) {
    const label = jobTypeLabel(schedule.jobType, t);
    if (
      !window.confirm(t("job_schedules_confirm_delete", { jobType: label }))
    ) {
      return;
    }
    setPendingAction({ id: schedule.id, kind: "delete" });
    try {
      await v1.deleteJobScheduleV1JobSchedulesScheduleIdDelete({
        scheduleId: schedule.id,
      });
      setBanner({
        kind: "success",
        message: t("job_schedules_delete_success"),
      });
      if (editingSchedule?.id === schedule.id) {
        setEditingSchedule(null);
      }
      await mutate();
    } catch (error: any) {
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setPendingAction(null);
    }
  }

  function clearFilters() {
    setOwnerFilter("me");
    setJobTypeFilter("");
    setActiveFilter("all");
    setPage(1);
  }

  const ownerFilterOptions: Array<{ value: OwnerFilter; label: string }> = [
    { value: "me", label: t("job_schedules_owner_me") },
    { value: "global", label: t("job_schedules_owner_global_only") },
    { value: "all", label: t("job_schedules_owner_all") },
  ];

  return (
    <div>
      <Nav />
      <Breadcrumbs items={breadcrumbs} />
      <main className="container py-6">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-xl font-semibold text-gray-900">
            {t("job_schedules_title")}
          </h1>
        </div>

        <form
          className="card p-4 mb-4 flex items-center gap-2 flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            mutate();
          }}
          role="search"
          aria-label={t("job_schedules_filters_label")}
        >
          <label
            className="text-sm text-gray-700"
            htmlFor="job-schedule-filter-owner"
          >
            {t("job_schedules_filter_owner_label")}
          </label>
          <select
            id="job-schedule-filter-owner"
            className="input"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value as OwnerFilter)}
          >
            {ownerFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label
            className="text-sm text-gray-700"
            htmlFor="job-schedule-filter-type"
          >
            {t("job_schedules_filter_job_type_label")}
          </label>
          <select
            id="job-schedule-filter-type"
            className="input"
            value={jobTypeFilter}
            onChange={(e) => setJobTypeFilter(e.target.value)}
          >
            <option value="">{t("job_schedules_filter_all_types")}</option>
            {JOB_TYPES.map((type) => (
              <option key={type} value={type}>
                {jobTypeLabel(type, t)}
              </option>
            ))}
          </select>

          <label
            className="text-sm text-gray-700"
            htmlFor="job-schedule-filter-active"
          >
            {t("job_schedules_filter_active_label")}
          </label>
          <select
            id="job-schedule-filter-active"
            className="input"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as ActiveFilter)}
          >
            <option value="all">{t("job_schedules_filter_active_all")}</option>
            <option value="active">
              {t("job_schedules_filter_active_true")}
            </option>
            <option value="paused">
              {t("job_schedules_filter_active_false")}
            </option>
          </select>

          <button type="submit" className="btn">
            {t("btn_search")}
          </button>
          <button type="button" className="btn" onClick={clearFilters}>
            {t("btn_clear_filters")}
          </button>
        </form>

        {banner && (
          <div className="mb-4">
            <Alert
              kind={banner.kind}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          </div>
        )}

        {canManageSchedules ? (
          <div className="card p-4 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {t("job_schedules_create_heading")}
            </h2>
            <ScheduleForm
              mode="create"
              credentials={credentials}
              siteConfigs={siteConfigs}
              feeds={feeds}
              onSubmit={handleCreate}
              isSubmitting={isCreating}
              allowOwnerSelection={canManageSchedules}
            />
          </div>
        ) : null}

        {editingSchedule ? (
          <div className="card p-4 mb-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {t("job_schedules_edit_heading", { id: editingSchedule.id })}
            </h2>
            <ScheduleForm
              mode="edit"
              initialSchedule={editingSchedule}
              credentials={credentials}
              siteConfigs={siteConfigs}
              feeds={feeds}
              onSubmit={handleUpdate}
              onCancel={() => setEditingSchedule(null)}
              isSubmitting={isEditing}
              allowOwnerSelection={false}
            />
          </div>
        ) : null}

        {isLoading && <p className="text-gray-600">{t("loading_text")}</p>}
        {error && <Alert kind="error" message={String(error)} />}

        <div className="card p-0 overflow-hidden">
          {schedules.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={
                  <span role="img" aria-label="calendar">
                    🗓️
                  </span>
                }
                message={
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-gray-700">
                      {t("job_schedules_empty_title")}
                    </p>
                    <p className="text-gray-600">
                      {t("job_schedules_empty_desc")}
                    </p>
                  </div>
                }
                action={
                  <button type="button" className="btn" onClick={clearFilters}>
                    {t("job_schedules_empty_action")}
                  </button>
                }
              />
            </div>
          ) : (
            <table
              className="table"
              aria-label={t("job_schedules_table_label")}
            >
              <thead className="bg-gray-100">
                <tr>
                  <th className="th" scope="col">
                    {t("job_schedules_column_job_type")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_frequency")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_next_run")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_last_run")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_last_job")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_scope")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_status")}
                  </th>
                  <th className="th" scope="col">
                    {t("job_schedules_column_actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => {
                  const isTogglePending =
                    pendingAction?.id === schedule.id &&
                    pendingAction?.kind === "toggle";
                  const isRunPending =
                    pendingAction?.id === schedule.id &&
                    pendingAction?.kind === "run";
                  const isDeletePending =
                    pendingAction?.id === schedule.id &&
                    pendingAction?.kind === "delete";
                  const isRowPending = Boolean(
                    pendingAction?.id === schedule.id,
                  );
                  const isExpanded = Boolean(expanded[schedule.id]);
                  return (
                    <React.Fragment key={schedule.id}>
                      <tr className="odd:bg-white even:bg-gray-50">
                        <td className="td">
                          {jobTypeLabel(schedule.jobType, t)}
                        </td>
                        <td className="td">{schedule.frequency}</td>
                        <td className="td">
                          {formatDateValue(schedule.nextRunAt)}
                        </td>
                        <td className="td">
                          {formatDateValue(schedule.lastRunAt)}
                        </td>
                        <td className="td">{schedule.lastJobId ?? "—"}</td>
                        <td className="td">{scopeLabel(schedule)}</td>
                        <td className="td">{statusLabel(schedule)}</td>
                        <td className="td">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn"
                              aria-expanded={isExpanded}
                              onClick={() =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [schedule.id]: !prev[schedule.id],
                                }))
                              }
                            >
                              {t("job_schedules_btn_details")}
                            </button>
                            {canManageSchedules && (
                              <>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => handleStartEdit(schedule)}
                                  disabled={
                                    loadingEditId === schedule.id ||
                                    isRowPending
                                  }
                                >
                                  {t("job_schedules_btn_edit")}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => handleToggle(schedule)}
                                  disabled={isTogglePending || isRowPending}
                                >
                                  {schedule.isActive
                                    ? t("job_schedules_btn_toggle_pause")
                                    : t("job_schedules_btn_toggle_resume")}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => handleRunNow(schedule)}
                                  disabled={isRunPending || isRowPending}
                                >
                                  {t("job_schedules_btn_run_now")}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => handleDelete(schedule)}
                                  disabled={isDeletePending || isRowPending}
                                >
                                  {t("job_schedules_btn_delete")}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td className="td" colSpan={8}>
                            <div className="p-4 space-y-3">
                              <div>
                                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                                  {t("job_schedules_metadata_heading")}
                                </h3>
                                <dl className="grid gap-2 md:grid-cols-2 text-sm text-gray-700">
                                  <div>
                                    <dt className="font-medium">
                                      {t("job_schedules_column_next_run")}
                                    </dt>
                                    <dd>
                                      {formatDateValue(schedule.nextRunAt)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="font-medium">
                                      {t("job_schedules_column_last_run")}
                                    </dt>
                                    <dd>
                                      {formatDateValue(schedule.lastRunAt)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="font-medium">
                                      {t("job_schedules_column_last_job")}
                                    </dt>
                                    <dd>{schedule.lastJobId ?? "—"}</dd>
                                  </div>
                                  <div>
                                    <dt className="font-medium">
                                      {t("job_schedules_column_status")}
                                    </dt>
                                    <dd>{statusLabel(schedule)}</dd>
                                  </div>
                                </dl>
                              </div>
                              <div>
                                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                                  {t("job_schedules_payload_heading")}
                                </h3>
                                <pre className="text-xs bg-white border rounded p-3 overflow-auto">
                                  {JSON.stringify(
                                    schedule.payload ?? {},
                                    null,
                                    2,
                                  )}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            className="btn"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            {t("pagination_prev")}
          </button>
          <span className="text-gray-700">
            {t("pagination_status", {
              page: numberFormatter.format(page),
              total: numberFormatter.format(totalPages || 1),
            })}
          </span>
          <button
            className="btn"
            disabled={!hasNext}
            onClick={() => setPage((prev) => prev + 1)}
          >
            {t("pagination_next")}
          </button>
        </div>
      </main>
    </div>
  );
}
