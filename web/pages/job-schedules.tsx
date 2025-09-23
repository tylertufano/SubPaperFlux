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
import type { SiteConfigOut } from "../sdk/src/models/SiteConfigOut";
import type { FeedOut } from "../sdk/src/models/FeedOut";
import type { JobSchedulesPage } from "../sdk/src/models/JobSchedulesPage";
import { useDateTimeFormatter, useNumberFormatter } from "../lib/format";
import { isValidUrl } from "../lib/validate";
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

type ExtendedJobSchedule = JobScheduleOut & {
  lastError?: string | null;
  lastErrorAt?: Date | null;
};

type ScheduleFormProps = {
  mode: ScheduleFormMode;
  initialSchedule?: ExtendedJobSchedule;
  credentials: Credential[];
  siteConfigs: SiteConfigOut[];
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

function initPayloadState(
  jobType: JobType,
  payload?: Record<string, any> | null,
): Record<string, any> {
  switch (jobType) {
    case "login":
      return {
        config_dir: payload?.config_dir ?? "",
        site_config_id: payload?.site_config_id ?? "",
        credential_id: payload?.credential_id ?? "",
      };
    case "miniflux_refresh":
      return {
        config_dir: payload?.config_dir ?? "",
        miniflux_id: payload?.miniflux_id ?? "",
        feed_ids_text: Array.isArray(payload?.feed_ids)
          ? payload.feed_ids.join(",")
          : "",
        cookie_key: payload?.cookie_key ?? "",
        site_config_id: payload?.site_config_id ?? "",
        credential_id: payload?.credential_id ?? "",
      };
    case "rss_poll":
      return {
        config_dir: payload?.config_dir ?? "",
        instapaper_id: payload?.instapaper_id ?? "",
        feed_url: payload?.feed_url ?? "",
        lookback: payload?.lookback ?? "",
        is_paywalled: Boolean(payload?.is_paywalled ?? false),
        rss_requires_auth: Boolean(payload?.rss_requires_auth ?? false),
        cookie_key: payload?.cookie_key ?? "",
        site_config_id: payload?.site_config_id ?? "",
      };
    case "publish":
      return {
        config_dir: payload?.config_dir ?? "",
        instapaper_id: payload?.instapaper_id ?? "",
        url: payload?.url ?? "",
        title: payload?.title ?? "",
        folder: payload?.folder ?? "",
        tags_text: Array.isArray(payload?.tags) ? payload.tags.join(", ") : "",
        feed_id: payload?.feed_id ?? "",
      };
    case "retention":
      return {
        older_than: payload?.older_than ?? "",
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
  jobType: JobType,
  t: ReturnType<typeof useI18n>["t"],
): string {
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

  function parseTags(value: string): string[] {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
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
      const configDir = (payloadState.config_dir || "").toString().trim();
      const siteConfigId = (payloadState.site_config_id || "")
        .toString()
        .trim();
      const credentialId = (payloadState.credential_id || "").toString().trim();
      if (!configDir)
        nextErrors["payload.config_dir"] = t("job_schedules_error_config_dir");
      if (!siteConfigId)
        nextErrors["payload.site_config_id"] = t(
          "job_schedules_error_site_config",
        );
      if (!credentialId)
        nextErrors["payload.credential_id"] = t(
          "job_schedules_error_credential",
        );
      payload.config_dir = configDir;
      payload.site_config_id = siteConfigId;
      payload.credential_id = credentialId;
    } else if (jobType === "miniflux_refresh") {
      const configDir = (payloadState.config_dir || "").toString().trim();
      const minifluxId = (payloadState.miniflux_id || "").toString().trim();
      const feedIdsText = (payloadState.feed_ids_text || "").toString().trim();
      const cookieKey = (payloadState.cookie_key || "").toString().trim();
      const siteConfigId = (payloadState.site_config_id || "")
        .toString()
        .trim();
      const credentialId = (payloadState.credential_id || "").toString().trim();
      if (!configDir)
        nextErrors["payload.config_dir"] = t("job_schedules_error_config_dir");
      if (!minifluxId)
        nextErrors["payload.miniflux_id"] = t("job_schedules_error_miniflux");
      if (!feedIdsText)
        nextErrors["payload.feed_ids"] = t("job_schedules_error_feed_ids");
      const feedIds: number[] = [];
      if (feedIdsText) {
        for (const part of feedIdsText
          .split(",")
          .map((entry: string) => entry.trim())
          .filter(Boolean)) {
          const parsed = Number(part);
          if (!Number.isFinite(parsed)) {
            nextErrors["payload.feed_ids"] = t("job_schedules_error_feed_ids");
            break;
          }
          feedIds.push(parsed);
        }
      }
      if (!cookieKey && !(siteConfigId && credentialId)) {
        nextErrors["payload.cookie_key"] = t(
          "job_schedules_error_miniflux_cookie",
        );
      }
      payload.config_dir = configDir;
      payload.miniflux_id = minifluxId;
      if (feedIds.length > 0) {
        payload.feed_ids = feedIds;
      }
      if (cookieKey) payload.cookie_key = cookieKey;
      if (siteConfigId) payload.site_config_id = siteConfigId;
      if (credentialId) payload.credential_id = credentialId;
    } else if (jobType === "rss_poll") {
      const configDir = (payloadState.config_dir || "").toString().trim();
      const instapaperId = (payloadState.instapaper_id || "").toString().trim();
      const feedUrl = (payloadState.feed_url || "").toString().trim();
      const lookback = (payloadState.lookback || "").toString().trim();
      const cookieKey = (payloadState.cookie_key || "").toString().trim();
      const siteConfigId = (payloadState.site_config_id || "")
        .toString()
        .trim();
      const isPaywalled = Boolean(payloadState.is_paywalled);
      const rssRequiresAuth = Boolean(payloadState.rss_requires_auth);
      if (!configDir)
        nextErrors["payload.config_dir"] = t("job_schedules_error_config_dir");
      if (!instapaperId)
        nextErrors["payload.instapaper_id"] = t(
          "job_schedules_error_instapaper",
        );
      if (!feedUrl || !isValidUrl(feedUrl))
        nextErrors["payload.feed_url"] = t("job_schedules_error_feed_url");
      payload.config_dir = configDir;
      payload.instapaper_id = instapaperId;
      payload.feed_url = feedUrl;
      if (lookback) payload.lookback = lookback;
      payload.is_paywalled = isPaywalled;
      payload.rss_requires_auth = rssRequiresAuth;
      if (cookieKey) payload.cookie_key = cookieKey;
      if (siteConfigId) payload.site_config_id = siteConfigId;
    } else if (jobType === "publish") {
      const configDir = (payloadState.config_dir || "").toString().trim();
      const instapaperId = (payloadState.instapaper_id || "").toString().trim();
      const url = (payloadState.url || "").toString().trim();
      const title = (payloadState.title || "").toString().trim();
      const folder = (payloadState.folder || "").toString().trim();
      const tagsText = (payloadState.tags_text || "").toString();
      const feedId = (payloadState.feed_id || "").toString().trim();
      if (!configDir)
        nextErrors["payload.config_dir"] = t("job_schedules_error_config_dir");
      if (!instapaperId)
        nextErrors["payload.instapaper_id"] = t(
          "job_schedules_error_instapaper",
        );
      if (!url || !isValidUrl(url))
        nextErrors["payload.url"] = t("job_schedules_error_url");
      payload.config_dir = configDir;
      payload.instapaper_id = instapaperId;
      payload.url = url;
      if (title) payload.title = title;
      if (folder) payload.folder = folder;
      const tags = parseTags(tagsText);
      if (tags.length > 0) payload.tags = tags;
      if (feedId) payload.feed_id = feedId;
    } else if (jobType === "retention") {
      const olderThan = (payloadState.older_than || "").toString().trim();
      if (!olderThan)
        nextErrors["payload.older_than"] = t("job_schedules_error_retention");
      payload.older_than = olderThan;
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

  function renderJobSpecificFields() {
    switch (jobType) {
      case "login":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-login-config-dir"
              >
                {t("job_schedules_field_config_dir")}
              </label>
              <input
                id="schedule-login-config-dir"
                className="input"
                value={payloadState.config_dir || ""}
                onChange={(e) => updatePayload("config_dir", e.target.value)}
                aria-invalid={Boolean(errors["payload.config_dir"])}
                aria-describedby={
                  errors["payload.config_dir"]
                    ? "schedule-login-config-dir-error"
                    : undefined
                }
              />
              {errors["payload.config_dir"] && (
                <p
                  id="schedule-login-config-dir-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.config_dir"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-login-site-config"
              >
                {t("job_schedules_field_site_config")}
              </label>
              <select
                id="schedule-login-site-config"
                className="input"
                value={payloadState.site_config_id || ""}
                onChange={(e) =>
                  updatePayload("site_config_id", e.target.value)
                }
                aria-invalid={Boolean(errors["payload.site_config_id"])}
                aria-describedby={
                  errors["payload.site_config_id"]
                    ? "schedule-login-site-config-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {siteConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
              {errors["payload.site_config_id"] && (
                <p
                  id="schedule-login-site-config-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.site_config_id"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-login-credential"
              >
                {t("job_schedules_field_credential")}
              </label>
              <select
                id="schedule-login-credential"
                className="input"
                value={payloadState.credential_id || ""}
                onChange={(e) => updatePayload("credential_id", e.target.value)}
                aria-invalid={Boolean(errors["payload.credential_id"])}
                aria-describedby={
                  errors["payload.credential_id"]
                    ? "schedule-login-credential-error"
                    : undefined
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {loginCredentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.description}
                  </option>
                ))}
              </select>
              {errors["payload.credential_id"] && (
                <p
                  id="schedule-login-credential-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.credential_id"]}
                </p>
              )}
            </div>
          </div>
        );
      case "miniflux_refresh":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-config-dir"
              >
                {t("job_schedules_field_config_dir")}
              </label>
              <input
                id="schedule-miniflux-config-dir"
                className="input"
                value={payloadState.config_dir || ""}
                onChange={(e) => updatePayload("config_dir", e.target.value)}
                aria-invalid={Boolean(errors["payload.config_dir"])}
                aria-describedby={
                  errors["payload.config_dir"]
                    ? "schedule-miniflux-config-dir-error"
                    : undefined
                }
              />
              {errors["payload.config_dir"] && (
                <p
                  id="schedule-miniflux-config-dir-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.config_dir"]}
                </p>
              )}
            </div>
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
                htmlFor="schedule-miniflux-feed-ids"
              >
                {t("job_schedules_field_feed_ids")}
              </label>
              <textarea
                id="schedule-miniflux-feed-ids"
                className="input min-h-[3rem]"
                value={payloadState.feed_ids_text || ""}
                onChange={(e) => updatePayload("feed_ids_text", e.target.value)}
                aria-invalid={Boolean(errors["payload.feed_ids"])}
                aria-describedby={
                  errors["payload.feed_ids"]
                    ? "schedule-miniflux-feed-ids-error"
                    : undefined
                }
              />
              <p className="text-sm text-gray-600 mt-1">
                {t("job_schedules_field_feed_ids_help")}
              </p>
              {errors["payload.feed_ids"] && (
                <p
                  id="schedule-miniflux-feed-ids-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.feed_ids"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-cookie-key"
              >
                {t("job_schedules_field_cookie_key")}
              </label>
              <input
                id="schedule-miniflux-cookie-key"
                className="input"
                value={payloadState.cookie_key || ""}
                onChange={(e) => updatePayload("cookie_key", e.target.value)}
                aria-invalid={Boolean(errors["payload.cookie_key"])}
                aria-describedby={
                  errors["payload.cookie_key"]
                    ? "schedule-miniflux-cookie-key-error"
                    : undefined
                }
              />
              <p className="text-sm text-gray-600 mt-1">
                {t("job_schedules_field_cookie_help")}
              </p>
              {errors["payload.cookie_key"] && (
                <p
                  id="schedule-miniflux-cookie-key-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.cookie_key"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-site-config"
              >
                {t("job_schedules_field_site_config_optional")}
              </label>
              <select
                id="schedule-miniflux-site-config"
                className="input"
                value={payloadState.site_config_id || ""}
                onChange={(e) =>
                  updatePayload("site_config_id", e.target.value)
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {siteConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-miniflux-login-cred"
              >
                {t("job_schedules_field_login_credential_optional")}
              </label>
              <select
                id="schedule-miniflux-login-cred"
                className="input"
                value={payloadState.credential_id || ""}
                onChange={(e) => updatePayload("credential_id", e.target.value)}
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {loginCredentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {cred.description}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      case "rss_poll":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-config-dir"
              >
                {t("job_schedules_field_config_dir")}
              </label>
              <input
                id="schedule-rss-config-dir"
                className="input"
                value={payloadState.config_dir || ""}
                onChange={(e) => updatePayload("config_dir", e.target.value)}
                aria-invalid={Boolean(errors["payload.config_dir"])}
                aria-describedby={
                  errors["payload.config_dir"]
                    ? "schedule-rss-config-dir-error"
                    : undefined
                }
              />
              {errors["payload.config_dir"] && (
                <p
                  id="schedule-rss-config-dir-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.config_dir"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-instapaper"
              >
                {t("job_schedules_field_instapaper_credential")}
              </label>
              <select
                id="schedule-rss-instapaper"
                className="input"
                value={payloadState.instapaper_id || ""}
                onChange={(e) => updatePayload("instapaper_id", e.target.value)}
                aria-invalid={Boolean(errors["payload.instapaper_id"])}
                aria-describedby={
                  errors["payload.instapaper_id"]
                    ? "schedule-rss-instapaper-error"
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
                  id="schedule-rss-instapaper-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.instapaper_id"]}
                </p>
              )}
            </div>
            <div className="flex flex-col md:col-span-2">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-feed-url"
              >
                {t("job_schedules_field_feed_url")}
              </label>
              <input
                id="schedule-rss-feed-url"
                className="input"
                value={payloadState.feed_url || ""}
                onChange={(e) => updatePayload("feed_url", e.target.value)}
                aria-invalid={Boolean(errors["payload.feed_url"])}
                aria-describedby={
                  errors["payload.feed_url"]
                    ? "schedule-rss-feed-url-error"
                    : undefined
                }
              />
              <p className="text-sm text-gray-600 mt-1">
                {t("job_schedules_field_feed_url_help")}
              </p>
              {errors["payload.feed_url"] && (
                <p
                  id="schedule-rss-feed-url-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.feed_url"]}
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
                onChange={(e) =>
                  updatePayload("is_paywalled", e.target.checked)
                }
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
                htmlFor="schedule-rss-cookie-key"
              >
                {t("job_schedules_field_cookie_key_optional")}
              </label>
              <input
                id="schedule-rss-cookie-key"
                className="input"
                value={payloadState.cookie_key || ""}
                onChange={(e) => updatePayload("cookie_key", e.target.value)}
              />
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-rss-site-config"
              >
                {t("job_schedules_field_site_config_optional")}
              </label>
              <select
                id="schedule-rss-site-config"
                className="input"
                value={payloadState.site_config_id || ""}
                onChange={(e) =>
                  updatePayload("site_config_id", e.target.value)
                }
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {siteConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
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
                htmlFor="schedule-publish-config-dir"
              >
                {t("job_schedules_field_config_dir")}
              </label>
              <input
                id="schedule-publish-config-dir"
                className="input"
                value={payloadState.config_dir || ""}
                onChange={(e) => updatePayload("config_dir", e.target.value)}
                aria-invalid={Boolean(errors["payload.config_dir"])}
                aria-describedby={
                  errors["payload.config_dir"]
                    ? "schedule-publish-config-dir-error"
                    : undefined
                }
              />
              {errors["payload.config_dir"] && (
                <p
                  id="schedule-publish-config-dir-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.config_dir"]}
                </p>
              )}
            </div>
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
                htmlFor="schedule-publish-url"
              >
                {t("job_schedules_field_publish_url")}
              </label>
              <input
                id="schedule-publish-url"
                className="input"
                value={payloadState.url || ""}
                onChange={(e) => updatePayload("url", e.target.value)}
                aria-invalid={Boolean(errors["payload.url"])}
                aria-describedby={
                  errors["payload.url"]
                    ? "schedule-publish-url-error"
                    : undefined
                }
              />
              {errors["payload.url"] && (
                <p
                  id="schedule-publish-url-error"
                  className="text-sm text-red-600 mt-1"
                >
                  {errors["payload.url"]}
                </p>
              )}
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-publish-title"
              >
                {t("job_schedules_field_publish_title")}
              </label>
              <input
                id="schedule-publish-title"
                className="input"
                value={payloadState.title || ""}
                onChange={(e) => updatePayload("title", e.target.value)}
              />
            </div>
            <div className="flex flex-col">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-publish-folder"
              >
                {t("job_schedules_field_publish_folder")}
              </label>
              <input
                id="schedule-publish-folder"
                className="input"
                value={payloadState.folder || ""}
                onChange={(e) => updatePayload("folder", e.target.value)}
              />
            </div>
            <div className="flex flex-col md:col-span-2">
              <label
                className="text-sm font-medium text-gray-700"
                htmlFor="schedule-publish-tags"
              >
                {t("job_schedules_field_publish_tags")}
              </label>
              <input
                id="schedule-publish-tags"
                className="input"
                value={payloadState.tags_text || ""}
                onChange={(e) => updatePayload("tags_text", e.target.value)}
              />
              <p className="text-sm text-gray-600 mt-1">
                {t("job_schedules_field_tags_help")}
              </p>
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
              >
                <option value="">{t("job_schedules_option_select")}</option>
                {feeds.map((feed) => (
                  <option key={feed.id} value={feed.id}>
                    {feed.url}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      case "retention":
        return (
          <div className="flex flex-col">
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

  const schedules: JobScheduleOut[] = data?.items ?? [];
  const credentials = credentialsData?.items ?? [];
  const siteConfigs = siteConfigsData?.items ?? [];
  const feeds = feedsData?.items ?? [];
  const hasNext = Boolean(data?.hasNext);
  const totalPages = data?.totalPages ?? data?.total ?? 1;
  const currentUserId =
    typeof session?.user?.id === "string" ? session.user.id : undefined;

  const formatDateValue = (value?: Date | null) =>
    value ? dateFormatter.format(value) : "—";

  const scopeLabel = (schedule: JobScheduleOut) => {
    if (!schedule.ownerUserId) {
      return t("scope_global");
    }
    if (schedule.ownerUserId === currentUserId) {
      return t("scope_user");
    }
    return schedule.ownerUserId;
  };

  const statusLabel = (schedule: JobScheduleOut) =>
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

  async function handleStartEdit(schedule: JobScheduleOut) {
    setLoadingEditId(schedule.id);
    try {
      const full = await v1.getJobScheduleV1JobSchedulesScheduleIdGet({
        scheduleId: schedule.id,
      });
      setEditingSchedule(full as ExtendedJobSchedule);
    } catch (error: any) {
      setEditingSchedule(schedule as ExtendedJobSchedule);
      setBanner({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setLoadingEditId(null);
    }
  }

  async function handleToggle(schedule: JobScheduleOut) {
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

  async function handleRunNow(schedule: JobScheduleOut) {
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

  async function handleDelete(schedule: JobScheduleOut) {
    const label = jobTypeLabel(schedule.jobType as JobType, t);
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
                    pendingAction.kind === "toggle";
                  const isRunPending =
                    pendingAction?.id === schedule.id &&
                    pendingAction.kind === "run";
                  const isDeletePending =
                    pendingAction?.id === schedule.id &&
                    pendingAction.kind === "delete";
                  const isRowPending = Boolean(
                    pendingAction?.id === schedule.id,
                  );
                  const isExpanded = Boolean(expanded[schedule.id]);
                  return (
                    <React.Fragment key={schedule.id}>
                      <tr className="odd:bg-white even:bg-gray-50">
                        <td className="td">
                          {jobTypeLabel(schedule.jobType as JobType, t)}
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
