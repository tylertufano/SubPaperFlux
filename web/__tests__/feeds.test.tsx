import React from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithSWR, makeSWRSuccess } from "./helpers/renderWithSWR";
import FeedsPage from "../pages/feeds";

const openApiSpies = vi.hoisted(() => ({
  listFeeds: vi.fn(),
  listSiteConfigs: vi.fn(),
  listCredentials: vi.fn(),
  listTags: vi.fn(),
  listFolders: vi.fn(),
  createFeed: vi.fn(),
  updateFeed: vi.fn(),
  deleteFeed: vi.fn(),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/feeds" }),
}));

vi.mock("../components", async () => {
  const actual = await vi.importActual<Record<string, any>>("../components");
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    __esModule: true,
    ...actual,
    Nav: () => ReactModule.createElement("nav", { "data-testid": "nav" }, "Nav"),
  };
});

vi.mock("../lib/openapi", () => ({
  __esModule: true,
  v1: {
    listFeedsV1V1FeedsGet: openApiSpies.listFeeds,
    listSiteConfigsV1V1SiteConfigsGet: openApiSpies.listSiteConfigs,
    listCredentialsV1V1CredentialsGet: openApiSpies.listCredentials,
    listTagsBookmarksTagsGet: openApiSpies.listTags,
    listFoldersBookmarksFoldersGet: openApiSpies.listFolders,
  },
  feeds: {
    createFeedFeedsPost: openApiSpies.createFeed,
    updateFeedFeedsFeedIdPut: openApiSpies.updateFeed,
    deleteFeedFeedsFeedIdDelete: openApiSpies.deleteFeed,
  },
}));

vi.mock("../lib/useSessionReauth", () => ({
  useSessionReauth: () => ({
    data: defaultSession,
    status: "authenticated",
  }),
}));

const defaultSession = {
  user: {
    id: "user-1",
    name: "Feed Manager",
    permissions: ["bookmarks:read", "bookmarks:manage"],
  },
  expires: "2099-01-01T00:00:00.000Z",
};

const defaultFeeds = {
  items: [
    {
      id: "feed-1",
      url: "https://news.example.com/rss",
      pollFrequency: "1h",
      isPaywalled: false,
      rssRequiresAuth: false,
      tagIds: ["tag-1", "tag-2"],
      folderId: "folder-1",
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

const defaultCredentials = {
  items: [],
};

const defaultSiteConfigs = {
  items: [],
};

type RenderOptions = {
  feeds?: typeof defaultFeeds;
  tags?: typeof defaultTags;
  folders?: typeof defaultFolders;
  mutate?: ReturnType<typeof vi.fn>;
};

function renderPage({
  feeds = defaultFeeds,
  tags = defaultTags,
  folders = defaultFolders,
  mutate = vi.fn().mockResolvedValue(undefined),
}: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/feeds",
      value: makeSWRSuccess(feeds, { mutate }),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/site-configs",
      value: makeSWRSuccess(defaultSiteConfigs),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/credentials",
      value: makeSWRSuccess(defaultCredentials),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/bookmarks/tags",
      value: makeSWRSuccess(tags),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/bookmarks/folders",
      value: makeSWRSuccess(folders),
    },
  ];

  renderWithSWR(<FeedsPage />, {
    locale: "en",
    swr: { handlers },
    session: defaultSession,
  });

  return { mutate };
}

describe("FeedsPage", () => {
  beforeEach(() => {
    cleanup();
    Object.values(openApiSpies).forEach((spy) => spy.mockReset());
    openApiSpies.listFeeds.mockResolvedValue(defaultFeeds);
    openApiSpies.listSiteConfigs.mockResolvedValue(defaultSiteConfigs);
    openApiSpies.listCredentials.mockResolvedValue(defaultCredentials);
    openApiSpies.listTags.mockResolvedValue(defaultTags);
    openApiSpies.listFolders.mockResolvedValue(defaultFolders);
    openApiSpies.createFeed.mockResolvedValue({});
    openApiSpies.updateFeed.mockResolvedValue({});
    openApiSpies.deleteFeed.mockResolvedValue({});
  });

  it("renders saved tags and folder for feeds", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "Feeds table" });
    const row = within(table).getByText("https://news.example.com/rss").closest("tr") as HTMLTableRowElement;

    expect(within(row).getByText("Research, News")).toBeInTheDocument();
    expect(within(row).getByText("Reading List")).toBeInTheDocument();
  });

  it("submits create form with selected tags and folder", async () => {
    const { mutate } = renderPage();

    const urlInput = screen.getByLabelText("Feed URL") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://example.com/new" } });

    const tagsCombobox = screen.getByRole("combobox", { name: "Tags" }) as HTMLInputElement;
    fireEvent.focus(tagsCombobox);
    fireEvent.change(tagsCombobox, { target: { value: "Research" } });
    const tagOption = await screen.findByRole("option", { name: "Research" });
    fireEvent.mouseDown(tagOption);
    fireEvent.click(tagOption);

    const folderCombobox = screen.getByRole("combobox", { name: "Folder" }) as HTMLInputElement;
    fireEvent.focus(folderCombobox);
    fireEvent.change(folderCombobox, { target: { value: "Reading" } });
    const folderOption = await screen.findByRole("option", { name: "Reading List" });
    fireEvent.mouseDown(folderOption);
    fireEvent.click(folderOption);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(openApiSpies.createFeed).toHaveBeenCalledTimes(1));

    expect(openApiSpies.createFeed).toHaveBeenCalledWith({
      feed: expect.objectContaining({
        url: "https://example.com/new",
        tagIds: ["tag-1"],
        folderId: "folder-1",
      }),
    });

    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });
});
