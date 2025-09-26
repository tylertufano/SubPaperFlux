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
    feed_id: "feed-1",
    lookback: "12h",
    is_paywalled: true,
    rss_requires_auth: true,
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

    const paywalledCheckbox = screen.getByLabelText(
      "Feed is paywalled",
    ) as HTMLInputElement;
    fireEvent.click(paywalledCheckbox);

    const requiresAuthCheckbox = screen.getByLabelText(
      "Feed requires authentication",
    ) as HTMLInputElement;
    fireEvent.click(requiresAuthCheckbox);

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
          is_paywalled: true,
          rss_requires_auth: true,
          site_login_pair: "cred-login::site-1",
        }),
      }),
    });
    const createdPayload =
      openApiSpies.createSchedule.mock.calls[0][0].jobScheduleCreate.payload;
    expect(createdPayload.instapaper_id).toBeUndefined();

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
          is_paywalled: true,
          rss_requires_auth: true,
        }),
      }),
    });
    const updatedPayload =
      openApiSpies.updateSchedule.mock.calls[0][0].jobScheduleUpdate.payload;
    expect(updatedPayload.site_login_pair).toBeUndefined();
    expect(updatedPayload.lookback).toBe("12h");
    expect(updatedPayload.is_paywalled).toBe(true);
    expect(updatedPayload.rss_requires_auth).toBe(true);

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Schedule updated.",
    );
  });
});
