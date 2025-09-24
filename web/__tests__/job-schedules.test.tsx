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
    instapaper_id: "cred-1",
    feed_url: "https://example.com/rss.xml",
    lookback: "1d",
    is_paywalled: false,
    rss_requires_auth: false,
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

const defaultCredentials = {
  items: [
    {
      id: "cred-1",
      kind: "instapaper",
      description: "Instapaper Account",
      data: {},
    },
    {
      id: "cred-login",
      kind: "site_login",
      description: "Site Login",
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
      isPaywalled: false,
      rssRequiresAuth: false,
      siteConfigId: null,
    },
  ],
};

type RenderOptions = {
  schedules?: typeof defaultSchedulesPage;
  credentials?: typeof defaultCredentials;
  siteConfigs?: typeof defaultSiteConfigs;
  feeds?: typeof defaultFeeds;
  mutate?: ReturnType<typeof vi.fn>;
};

function renderPage({
  schedules = defaultSchedulesPage,
  credentials = defaultCredentials,
  siteConfigs = defaultSiteConfigs,
  feeds = defaultFeeds,
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
  ];

  renderWithSWR(<JobSchedulesPage />, {
    locale: "en",
    swr: { handlers },
    session: defaultSession,
  });

  return { mutate };
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
      screen.getByText(/"instapaper_id": "cred-1"/),
    ).toBeInTheDocument();
  });

  it("submits create schedule form with rss poll payload", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    renderPage({ mutate });

    const frequencyInput = screen.getByLabelText(
      "Frequency",
    ) as HTMLInputElement;
    fireEvent.change(frequencyInput, { target: { value: "2h" } });

    const instapaperSelect = screen.getByLabelText(
      "Instapaper credential",
    ) as HTMLSelectElement;
    fireEvent.change(instapaperSelect, { target: { value: "cred-1" } });

    const feedUrlInput = screen.getByLabelText("Feed URL") as HTMLInputElement;
    fireEvent.change(feedUrlInput, {
      target: { value: "https://example.com/feed.xml" },
    });

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
          instapaper_id: "cred-1",
          feed_url: "https://example.com/feed.xml",
        }),
      }),
    });

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Schedule created.",
    );
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
    const feedUrlInput = within(editForm).getByDisplayValue(
      "https://example.com/rss.xml",
    ) as HTMLInputElement;
    fireEvent.change(frequencyInput, { target: { value: "30m" } });
    fireEvent.change(feedUrlInput, {
      target: { value: "https://example.com/rss-updated.xml" },
    });

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
          feed_url: "https://example.com/rss-updated.xml",
        }),
      }),
    });

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Schedule updated.",
    );
  });
});
