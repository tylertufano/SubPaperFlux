import React from "react";
import {
  cleanup,
  fireEvent,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithSWR, makeSWRSuccess } from "./helpers/renderWithSWR";
import JobSchedulesPage from "../pages/job-schedules";

const openApiSpies = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  runSchedule: vi.fn(),
  listCredentials: vi.fn(),
  listSiteConfigs: vi.fn(),
  listFeeds: vi.fn(),
  listTags: vi.fn(),
  listFolders: vi.fn(),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/job-schedules" }),
}));

vi.mock("../components", async () => {
  const actual = await vi.importActual<Record<string, any>>("../components");
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    __esModule: true,
    ...actual,
    Nav: () =>
      ReactModule.createElement("nav", { "data-testid": "nav" }, "Nav"),
  };
});

vi.mock("../lib/openapi", () => ({
  __esModule: true,
  v1: {
    listJobSchedulesV1JobSchedulesGet: openApiSpies.listSchedules,
    createJobScheduleV1JobSchedulesPost: openApiSpies.createSchedule,
    updateJobScheduleV1JobSchedulesScheduleIdPatch: openApiSpies.updateSchedule,
    getJobScheduleV1JobSchedulesScheduleIdGet: openApiSpies.getSchedule,
    deleteJobScheduleV1JobSchedulesScheduleIdDelete:
      openApiSpies.deleteSchedule,
    toggleJobScheduleV1JobSchedulesScheduleIdTogglePost:
      openApiSpies.toggleSchedule,
    runJobScheduleNowV1JobSchedulesScheduleIdRunNowPost:
      openApiSpies.runSchedule,
    listCredentialsV1V1CredentialsGet: openApiSpies.listCredentials,
    listSiteConfigsV1V1SiteConfigsGet: openApiSpies.listSiteConfigs,
    listFeedsV1V1FeedsGet: openApiSpies.listFeeds,
    listTagsBookmarksTagsGet: openApiSpies.listTags,
    listFoldersBookmarksFoldersGet: openApiSpies.listFolders,
  },
}));

const defaultSession = {
  user: {
    id: "user-123",
    name: "Test User",
    permissions: ["bookmarks:manage"],
  },
  expires: "2099-01-01T00:00:00.000Z",
};

const defaultSchedule = {
  id: "schedule-1",
  jobType: "rss_poll",
  payload: {
    feed_id: "feed-1",
    lookback: "12h",
    site_login_pair: "cred-login::site-1",
  },
  frequency: "1h",
  nextRunAt: new Date("2024-02-01T10:00:00Z"),
  lastRunAt: new Date("2024-01-31T12:00:00Z"),
  lastJobId: "job-123",
  isActive: true,
  ownerUserId: "user-123",
};

const defaultSchedulesPage = {
  items: [defaultSchedule],
  total: 1,
  page: 1,
  size: 20,
  hasNext: false,
  totalPages: 1,
};

function makePublishSchedule({
  id,
  feedId,
}: {
  id: string;
  feedId?: string | null;
}) {
  return {
    id,
    jobType: "publish",
    payload: {
      instapaper_id: "cred-publish",
      ...(feedId ? { feed_id: feedId } : {}),
    },
    frequency: "15m",
    nextRunAt: new Date("2024-02-02T10:00:00Z"),
    lastRunAt: null,
    lastJobId: null,
    isActive: true,
    ownerUserId: "user-123",
  };
}

const defaultCredentials = {
  items: [
    {
      id: "cred-login",
      kind: "site_login",
      description: "Site Login",
      data: {},
      siteConfigId: "site-1",
    },
    {
      id: "cred-publish",
      kind: "instapaper",
      description: "Instapaper Account",
      data: {},
    },
  ],
};

const defaultSiteConfigs = {
  items: [
    {
      id: "site-1",
      name: "Example Site",
      siteUrl: "https://example.com",
      usernameSelector: "#user",
      passwordSelector: "#pass",
      loginButtonSelector: "#submit",
      cookiesToStore: [],
    },
  ],
};

const defaultFeeds = {
  items: [
    {
      id: "feed-1",
      url: "https://example.com/feed.xml",
      pollFrequency: "1h",
      initialLookbackPeriod: "1d",
      isPaywalled: true,
      rssRequiresAuth: true,
      siteConfigId: "site-1",
      siteLoginCredentialId: "cred-login",
    },
    {
      id: "feed-2",
      url: "https://example.com/rss-updated.xml",
      pollFrequency: "30m",
      initialLookbackPeriod: "1d",
      isPaywalled: false,
      rssRequiresAuth: false,
      siteConfigId: null,
    },
  ],
};

const defaultTags = {
  items: [
    { id: "tag-1", name: "Research" },
    { id: "tag-2", name: "News" },
  ],
};

const defaultFolders = {
  items: [
    { id: "folder-1", name: "Reading List" },
    { id: "folder-2", name: "Highlights" },
  ],
};

type RenderOptions = {
  schedules?: typeof defaultSchedulesPage;
  credentials?: typeof defaultCredentials;
  siteConfigs?: typeof defaultSiteConfigs;
  feeds?: typeof defaultFeeds;
  tags?: typeof defaultTags;
  folders?: typeof defaultFolders;
  mutate?: ReturnType<typeof vi.fn>;
};

function renderPage({
  schedules = defaultSchedulesPage,
  credentials = defaultCredentials,
  siteConfigs = defaultSiteConfigs,
  feeds = defaultFeeds,
  tags = defaultTags,
  folders = defaultFolders,
  mutate = vi.fn().mockResolvedValue(undefined),
}: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) =>
        Array.isArray(key) && key[0] === "/v1/job-schedules",
      value: makeSWRSuccess(schedules, { mutate }),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/credentials",
      value: makeSWRSuccess(credentials),
    },
    {
      matcher: (key: any) =>
        Array.isArray(key) && key[0] === "/v1/site-configs",
      value: makeSWRSuccess(siteConfigs),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/feeds",
      value: makeSWRSuccess(feeds),
    },
    {
      matcher: (key: any) =>
        Array.isArray(key) && key[0] === "/v1/bookmarks/tags",
      value: makeSWRSuccess(tags),
    },
    {
      matcher: (key: any) =>
        Array.isArray(key) && key[0] === "/v1/bookmarks/folders",
      value: makeSWRSuccess(folders),
    },
  ];

  renderWithSWR(<JobSchedulesPage />, {
    locale: "en",
    swr: { handlers },
    session: defaultSession,
  });

  return { mutate };
}

function getSiteLoginSelect(form?: HTMLFormElement): HTMLSelectElement | null {
  const elements = Array.from(
    document.querySelectorAll<HTMLSelectElement>("#schedule-rss-site-login"),
  );
  if (form) {
    const match = elements.find(
      (element) => element.closest("form") === form,
    );
    return match ?? null;
  }
  return elements[0] ?? null;
}

describe("JobSchedulesPage", () => {
  beforeEach(() => {
    cleanup();
    Object.values(openApiSpies).forEach((spy) => spy.mockReset());
    openApiSpies.createSchedule.mockResolvedValue({});
    openApiSpies.updateSchedule.mockResolvedValue({});
    openApiSpies.getSchedule.mockResolvedValue(defaultSchedule);
    openApiSpies.deleteSchedule.mockResolvedValue({});
    openApiSpies.toggleSchedule.mockResolvedValue({
      ...defaultSchedule,
      isActive: false,
    });
    openApiSpies.runSchedule.mockResolvedValue({ id: "job-999" });
    openApiSpies.listCredentials.mockResolvedValue(defaultCredentials);
    openApiSpies.listSiteConfigs.mockResolvedValue(defaultSiteConfigs);
    openApiSpies.listFeeds.mockResolvedValue(defaultFeeds);
    openApiSpies.listTags.mockResolvedValue(defaultTags);
    openApiSpies.listFolders.mockResolvedValue(defaultFolders);
    openApiSpies.listSchedules.mockResolvedValue(defaultSchedulesPage);
  });

  it("renders schedule list with expandable details", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Schedules" }),
    ).toBeInTheDocument();

    const table = await screen.findByRole("table", { name: "Scheduled jobs" });
    const row = within(table)
      .getByText("RSS poll")
      .closest("tr") as HTMLElement;

    expect(within(row).getByText("1h")).toBeInTheDocument();
    expect(within(row).getByText("job-123")).toBeInTheDocument();
    expect(within(row).getByText("User")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();

    const detailsButton = within(row).getByRole("button", { name: "Details" });
    fireEvent.click(detailsButton);

    expect(await screen.findByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("Payload")).toBeInTheDocument();
    expect(
      screen.getByText(/"site_login_pair": "cred-login::site-1"/),
    ).toBeInTheDocument();
  });

  it("renders localized calendar label for the empty state icon", async () => {
    renderPage({
      schedules: {
        ...defaultSchedulesPage,
        items: [],
        total: 0,
        totalPages: 0,
      },
    });

    expect(
      await screen.findByRole(
        "img",
        {
          name: "Calendar icon representing an empty schedule list",
          hidden: true,
        },
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
  });

  it("renders a fallback label when a schedule job type is missing", async () => {
    renderPage({
      schedules: {
        ...defaultSchedulesPage,
        items: [
          {
            ...defaultSchedule,
            id: "schedule-unknown",
            jobType: undefined,
          },
        ],
      },
    });

    const table = await screen.findByRole("table", { name: "Scheduled jobs" });

    expect(within(table).getByText("Unknown")).toBeInTheDocument();
    expect(within(table).queryByText("job_type_undefined")).not.toBeInTheDocument();
  });

  it("renders a job type label when the API returns snake_case fields", async () => {
    renderPage({
      schedules: {
        ...defaultSchedulesPage,
        items: [
          {
            ...defaultSchedule,
            jobType: undefined,
            job_type: "rss_poll",
          } as any,
        ],
      },
    });

    const table = await screen.findByRole("table", { name: "Scheduled jobs" });

    expect(within(table).getByText("RSS poll")).toBeInTheDocument();
    expect(within(table).queryByText("Unknown")).not.toBeInTheDocument();
  });

  it("submits create schedule form with rss poll payload", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    renderPage({ mutate });

    const frequencyInput = screen.getByLabelText(
      "Frequency",
    ) as HTMLInputElement;
    fireEvent.change(frequencyInput, { target: { value: "2h" } });

    const feedSelect = (await screen.findByLabelText(
      "Saved feed",
    )) as HTMLSelectElement;
    fireEvent.change(feedSelect, { target: { value: "feed-1" } });

    const lookbackInput = screen.getByLabelText(
      "Lookback window",
    ) as HTMLInputElement;
    fireEvent.change(lookbackInput, { target: { value: "6h" } });

    const siteLoginSelect = getSiteLoginSelect();
    expect(siteLoginSelect).not.toBeNull();

    await waitFor(() =>
      expect(siteLoginSelect!.value).toBe("cred-login::site-1"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() =>
      expect(openApiSpies.createSchedule).toHaveBeenCalledTimes(1),
    );
    expect(openApiSpies.createSchedule).toHaveBeenCalledWith({
      jobScheduleCreate: expect.objectContaining({
        jobType: "rss_poll",
        frequency: "2h",
        isActive: true,
        payload: expect.objectContaining({
          feed_id: "feed-1",
          lookback: "6h",
          site_login_pair: "cred-login::site-1",
        }),
      }),
    });
    const createdPayload =
      openApiSpies.createSchedule.mock.calls[0][0].jobScheduleCreate.payload;
    expect(createdPayload.instapaper_id).toBeUndefined();
    expect(createdPayload.is_paywalled).toBeUndefined();
    expect(createdPayload.rss_requires_auth).toBeUndefined();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Schedule created.",
    );
  });

  it("sends normalized credential identifiers when creating login schedules", async () => {
    renderPage();

    const createButton = screen.getByRole("button", {
      name: "Create schedule",
    });
    const createForm = createButton.closest("form");
    expect(createForm).toBeTruthy();

    const jobTypeSelect = within(createForm as HTMLElement).getByLabelText(
      "Job type",
    ) as HTMLSelectElement;
    fireEvent.change(jobTypeSelect, { target: { value: "login" } });

    const siteLoginSelect = await waitFor(() =>
      within(createForm as HTMLElement).getByLabelText("Site login credential"),
    );
    fireEvent.change(siteLoginSelect, {
      target: { value: "cred-login::site-1" },
    });

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(openApiSpies.createSchedule).toHaveBeenCalledTimes(1),
    );

    const createdPayload =
      openApiSpies.createSchedule.mock.calls[0][0].jobScheduleCreate.payload;
    expect(createdPayload.site_login_pair).toBe("cred-login::site-1");
  });

  it("loads existing schedule for editing and saves updates", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    renderPage({ mutate });

    const editButton = await screen.findByRole("button", { name: "Edit" });
    fireEvent.click(editButton);

    await waitFor(() =>
      expect(openApiSpies.getSchedule).toHaveBeenCalledWith({
        scheduleId: "schedule-1",
      }),
    );

    const saveButton = await screen.findByRole("button", {
      name: "Save changes",
    });
    const editForm = saveButton.closest("form") as HTMLFormElement;

    const frequencyInput = within(editForm).getByDisplayValue(
      "1h",
    ) as HTMLInputElement;
    const feedSelect = within(editForm).getByLabelText(
      "Saved feed",
    ) as HTMLSelectElement;
    const siteLoginSelect = getSiteLoginSelect(editForm);
    expect(siteLoginSelect).not.toBeNull();

    await waitFor(() =>
      expect(siteLoginSelect!.value).toBe("cred-login::site-1"),
    );

    fireEvent.change(frequencyInput, { target: { value: "30m" } });
    fireEvent.change(feedSelect, { target: { value: "feed-2" } });

    await waitFor(() => expect(siteLoginSelect!.value).toBe(""));

    const activeCheckbox = within(editForm).getByRole("checkbox", {
      name: "Schedule is active",
    });

    fireEvent.click(activeCheckbox);

    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(openApiSpies.updateSchedule).toHaveBeenCalledTimes(1),
    );
    expect(openApiSpies.updateSchedule).toHaveBeenCalledWith({
      scheduleId: "schedule-1",
      jobScheduleUpdate: expect.objectContaining({
        jobType: "rss_poll",
        frequency: "30m",
        isActive: false,
        payload: expect.objectContaining({
          feed_id: "feed-2",
          lookback: "12h",
        }),
      }),
    });
    const updatedPayload =
      openApiSpies.updateSchedule.mock.calls[0][0].jobScheduleUpdate.payload;
    expect(updatedPayload.site_login_pair).toBeUndefined();
    expect(updatedPayload.lookback).toBe("12h");
    expect(updatedPayload.is_paywalled).toBeUndefined();
    expect(updatedPayload.rss_requires_auth).toBeUndefined();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Schedule updated.",
    );
  });

  it("creates publish schedules without a feed when no conflicts exist", async () => {
    renderPage();

    const createButton = screen.getByRole("button", {
      name: "Create schedule",
    });
    const createForm = createButton.closest("form") as HTMLFormElement;

    const jobTypeSelect = within(createForm).getByLabelText(
      "Job type",
    ) as HTMLSelectElement;
    fireEvent.change(jobTypeSelect, { target: { value: "publish" } });

    const instapaperSelect = await within(createForm).findByLabelText(
      "Instapaper credential",
    );
    fireEvent.change(instapaperSelect, { target: { value: "cred-publish" } });

    const feedSelect = within(createForm).getByLabelText(
      "Attach to feed (optional)",
    ) as HTMLSelectElement;
    expect(feedSelect.value).toBe("");

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(openApiSpies.createSchedule).toHaveBeenCalledTimes(1),
    );

    const createdPayload =
      openApiSpies.createSchedule.mock.calls[0][0].jobScheduleCreate.payload;
    expect(createdPayload.instapaper_id).toBe("cred-publish");
    expect(createdPayload.feed_id).toBeUndefined();
  });

  it("submits publish schedules with tags and a folder override", async () => {
    renderPage();

    const createButton = screen.getByRole("button", {
      name: "Create schedule",
    });
    const createForm = createButton.closest("form") as HTMLFormElement;

    const jobTypeSelect = within(createForm).getByLabelText(
      "Job type",
    ) as HTMLSelectElement;
    fireEvent.change(jobTypeSelect, { target: { value: "publish" } });

    const instapaperSelect = await within(createForm).findByLabelText(
      "Instapaper credential",
    );
    fireEvent.change(instapaperSelect, { target: { value: "cred-publish" } });

    const tagsCombobox = within(createForm).getByRole("combobox", {
      name: "Tags to apply",
    }) as HTMLInputElement;
    fireEvent.focus(tagsCombobox);
    fireEvent.change(tagsCombobox, { target: { value: "Research" } });
    const tagOption = await within(createForm).findByRole("option", {
      name: "Research",
    });
    fireEvent.mouseDown(tagOption);
    fireEvent.click(tagOption);

    const folderCombobox = within(createForm).getByRole("combobox", {
      name: "Folder override",
    }) as HTMLInputElement;
    fireEvent.focus(folderCombobox);
    fireEvent.change(folderCombobox, { target: { value: "Reading" } });
    const folderOption = await within(createForm).findByRole("option", {
      name: "Reading List",
    });
    fireEvent.mouseDown(folderOption);
    fireEvent.click(folderOption);

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(openApiSpies.createSchedule).toHaveBeenCalledTimes(1),
    );

    const createdPayload =
      openApiSpies.createSchedule.mock.calls[0][0].jobScheduleCreate.payload;
    expect(createdPayload.tags).toEqual(["tag-1"]);
    expect(createdPayload.folderId).toBe("folder-1");

    expect(
      within(createForm).getByText(
        "This schedule will override the feed's folder when it runs.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks wildcard publish schedules when one already exists", async () => {
    renderPage({
      schedules: {
        ...defaultSchedulesPage,
        items: [makePublishSchedule({ id: "publish-existing" })],
      },
    });

    const createButton = screen.getByRole("button", {
      name: "Create schedule",
    });
    const createForm = createButton.closest("form") as HTMLFormElement;

    const jobTypeSelect = within(createForm).getByLabelText(
      "Job type",
    ) as HTMLSelectElement;
    fireEvent.change(jobTypeSelect, { target: { value: "publish" } });

    const instapaperSelect = await within(createForm).findByLabelText(
      "Instapaper credential",
    );
    fireEvent.change(instapaperSelect, { target: { value: "cred-publish" } });

    const feedSelect = within(createForm).getByLabelText(
      "Attach to feed (optional)",
    ) as HTMLSelectElement;
    expect(
      within(createForm).getByText(
        "A wildcard publish schedule already exists for this Instapaper credential. No additional publish schedules can be created.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(feedSelect, { target: { value: "feed-1" } });
    expect(feedSelect.value).toBe("feed-1");
    expect(
      within(createForm).getByText(
        "A wildcard publish schedule already exists for this Instapaper credential. No additional publish schedules can be created.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(openApiSpies.createSchedule).not.toHaveBeenCalled(),
    );

    const wildcardConflicts = await within(createForm).findAllByText(
      "A wildcard publish schedule already exists for this Instapaper credential. No additional publish schedules can be created.",
    );
    expect(wildcardConflicts.length).toBeGreaterThan(0);
    await expect(
      within(createForm).findByRole("alert"),
    ).resolves.toHaveTextContent(
      "A wildcard publish schedule already exists for this Instapaper credential. No additional publish schedules can be created.",
    );
  });

  it("requires a feed when targeted publish schedules already exist", async () => {
    renderPage({
      schedules: {
        ...defaultSchedulesPage,
        items: [makePublishSchedule({ id: "publish-targeted", feedId: "feed-1" })],
      },
    });

    const createButton = screen.getByRole("button", {
      name: "Create schedule",
    });
    const createForm = createButton.closest("form") as HTMLFormElement;

    const jobTypeSelect = within(createForm).getByLabelText(
      "Job type",
    ) as HTMLSelectElement;
    fireEvent.change(jobTypeSelect, { target: { value: "publish" } });

    const instapaperSelect = await within(createForm).findByLabelText(
      "Instapaper credential",
    );
    fireEvent.change(instapaperSelect, { target: { value: "cred-publish" } });

    expect(
      within(createForm).getByText(
        "Targeted schedules already exist for this Instapaper credential. Select a feed to create another schedule.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(openApiSpies.createSchedule).not.toHaveBeenCalled(),
    );

    const targetedErrors = await within(createForm).findAllByText(
      "Select a feed because targeted schedules already exist for this Instapaper credential.",
    );
    expect(targetedErrors.length).toBeGreaterThan(0);
    await expect(
      within(createForm).findByRole("alert"),
    ).resolves.toHaveTextContent(
      "Select a feed because targeted schedules already exist for this Instapaper credential.",
    );
  });

  it("allows targeted publish schedules when conflicts are resolved", async () => {
    renderPage({
      schedules: {
        ...defaultSchedulesPage,
        items: [makePublishSchedule({ id: "publish-targeted", feedId: "feed-1" })],
      },
    });

    const createButton = screen.getByRole("button", {
      name: "Create schedule",
    });
    const createForm = createButton.closest("form") as HTMLFormElement;

    const jobTypeSelect = within(createForm).getByLabelText(
      "Job type",
    ) as HTMLSelectElement;
    fireEvent.change(jobTypeSelect, { target: { value: "publish" } });

    const instapaperSelect = await within(createForm).findByLabelText(
      "Instapaper credential",
    );
    fireEvent.change(instapaperSelect, { target: { value: "cred-publish" } });

    const feedSelect = within(createForm).getByLabelText(
      "Attach to feed (optional)",
    ) as HTMLSelectElement;
    fireEvent.change(feedSelect, { target: { value: "feed-2" } });

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(openApiSpies.createSchedule).toHaveBeenCalledTimes(1),
    );

    const createdPayload =
      openApiSpies.createSchedule.mock.calls[0][0].jobScheduleCreate.payload;
    expect(createdPayload.instapaper_id).toBe("cred-publish");
    expect(createdPayload.feed_id).toBe("feed-2");
  });
});
