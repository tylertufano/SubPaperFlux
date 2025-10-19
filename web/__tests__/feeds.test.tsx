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
  createTag: vi.fn(),
  createFolder: vi.fn(),
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
    createTagBookmarksTagsPost: openApiSpies.createTag,
    createFolderBookmarksFoldersPost: openApiSpies.createFolder,
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
      initialLookbackPeriod: "",
      lastRssPollAt: null,
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

type SimpleList<T = any> = { items: T[] };

const defaultCredentials: SimpleList = {
  items: [],
};

const defaultSiteConfigs: SimpleList = {
  items: [],
};

type RenderOptions = {
  feeds?: typeof defaultFeeds;
  tags?: typeof defaultTags;
  folders?: typeof defaultFolders;
  credentials?: SimpleList;
  siteConfigs?: SimpleList;
  mutate?: ReturnType<typeof vi.fn>;
  tagMutate?: ReturnType<typeof vi.fn>;
  folderMutate?: ReturnType<typeof vi.fn>;
};

function renderPage({
  feeds = defaultFeeds,
  tags = defaultTags,
  folders = defaultFolders,
  credentials = defaultCredentials,
  siteConfigs = defaultSiteConfigs,
  mutate = vi.fn().mockResolvedValue(undefined),
  tagMutate = vi.fn().mockResolvedValue(undefined),
  folderMutate = vi.fn().mockResolvedValue(undefined),
}: RenderOptions = {}) {
  const handlers = [
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/feeds",
      value: makeSWRSuccess(feeds, { mutate }),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/site-configs",
      value: makeSWRSuccess(siteConfigs),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/credentials",
      value: makeSWRSuccess(credentials),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/bookmarks/tags",
      value: makeSWRSuccess(tags, { mutate: tagMutate }),
    },
    {
      matcher: (key: any) => Array.isArray(key) && key[0] === "/v1/bookmarks/folders",
      value: makeSWRSuccess(folders, { mutate: folderMutate }),
    },
  ];

  renderWithSWR(<FeedsPage />, {
    locale: "en",
    swr: { handlers },
    session: defaultSession,
  });

  return { mutate, tagMutate, folderMutate };
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
    openApiSpies.createTag.mockResolvedValue({ id: "tag-new", name: "Created" });
    openApiSpies.createFolder.mockResolvedValue({
      id: "folder-new",
      name: "Created Folder",
    });
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

  it("creates new tags and folders from combobox input", async () => {
    const tagMutate = vi.fn().mockResolvedValue(undefined);
    const folderMutate = vi.fn().mockResolvedValue(undefined);
    openApiSpies.createTag.mockResolvedValue({
      id: "tag-new",
      name: "Curated",
    });
    openApiSpies.createFolder.mockResolvedValue({
      id: "folder-new",
      name: "Later",
    });

    renderPage({ tagMutate, folderMutate });

    const urlInput = screen.getByLabelText("Feed URL") as HTMLInputElement;
    fireEvent.change(urlInput, {
      target: { value: "https://example.com/created" },
    });

    const tagsCombobox = screen.getByRole("combobox", {
      name: "Tags",
    }) as HTMLInputElement;
    fireEvent.change(tagsCombobox, { target: { value: "Curated" } });

    await screen.findByRole("option", { name: 'Create "Curated"' });
    fireEvent.keyDown(tagsCombobox, { key: "Enter" });

    await waitFor(() =>
      expect(openApiSpies.createTag).toHaveBeenCalledWith({
        tagCreate: { name: "Curated" },
      }),
    );
    await waitFor(() => expect(tagMutate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Curated")).toBeInTheDocument());

    const folderCombobox = screen.getByRole("combobox", {
      name: "Folder",
    }) as HTMLInputElement;
    fireEvent.change(folderCombobox, { target: { value: "Later" } });

    await screen.findByRole("option", { name: 'Create "Later"' });
    fireEvent.keyDown(folderCombobox, { key: "Enter" });

    await waitFor(() =>
      expect(openApiSpies.createFolder).toHaveBeenCalledWith({
        folderCreate: { name: "Later" },
      }),
    );
    await waitFor(() => expect(folderMutate).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(openApiSpies.createFeed).toHaveBeenCalled());

    const payload = openApiSpies.createFeed.mock.calls[0][0].feed;
    expect(payload.tagIds).toContain("tag-new");
    expect(payload.folderId).toBe("folder-new");
  });

  it("requires a site login pair when marking a new feed as paywalled", async () => {
    const siteConfigs = {
      items: [{ id: "config-1", name: "Example Site" }],
    };
    const credentials = {
      items: [
        {
          id: "cred-1",
          description: "Example Credential",
          kind: "site_login",
          data: { site_config_id: "config-1" },
        },
      ],
    };
    const { mutate } = renderPage({ siteConfigs, credentials });

    const urlInput = screen.getByLabelText("Feed URL") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://example.com/paywalled" } });

    const paywalledCheckbox = screen.getByLabelText("Paywalled") as HTMLInputElement;
    expect(paywalledCheckbox.checked).toBe(false);
    fireEvent.click(paywalledCheckbox);
    expect(paywalledCheckbox.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText(
      "Site login credentials are required when RSS requires authentication or content is paywalled",
    );
    expect(openApiSpies.createFeed).not.toHaveBeenCalled();

    const siteLoginSelect = screen.getByLabelText(
      "Select a site login or configuration (optional)",
    ) as HTMLSelectElement;
    fireEvent.change(siteLoginSelect, { target: { value: "cred-1::config-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(openApiSpies.createFeed).toHaveBeenCalledTimes(1));
    const payload = openApiSpies.createFeed.mock.calls[0][0].feed;
    expect(payload.siteConfigId).toBe("config-1");
    expect(payload.siteLoginCredentialId).toBe("cred-1");
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });

  it("blocks editing when paywall is enabled without a credential/config pair", async () => {
    const siteConfigs = {
      items: [{ id: "config-1", name: "Example Site" }],
    };
    const credentials = {
      items: [
        {
          id: "cred-1",
          description: "Example Credential",
          kind: "site_login",
          data: { site_config_id: "config-1" },
        },
      ],
    };
    const feeds = {
      items: [
        {
          ...defaultFeeds.items[0],
          id: "feed-no-login",
          siteConfigId: "",
          siteLoginCredentialId: "",
        },
      ],
    };
    const { mutate } = renderPage({ feeds, siteConfigs, credentials });

    const table = await screen.findByRole("table", { name: "Feeds table" });
    const row = within(table).getByText("https://news.example.com/rss").closest("tr") as HTMLTableRowElement;

    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const editForm = await screen.findByRole("form", { name: "Edit Feed" });

    const editPaywalledCheckbox = within(editForm).getByLabelText("Paywalled") as HTMLInputElement;
    expect(editPaywalledCheckbox.checked).toBe(false);
    fireEvent.click(editPaywalledCheckbox);
    expect(editPaywalledCheckbox.checked).toBe(true);

    fireEvent.click(within(editForm).getByRole("button", { name: "Save" }));

    await screen.findByText(
      "Site login credentials are required when RSS requires authentication or content is paywalled",
    );
    expect(openApiSpies.updateFeed).not.toHaveBeenCalled();

    const editSelect = within(editForm).getByLabelText(
      "Select a site login or configuration (optional)",
    ) as HTMLSelectElement;
    fireEvent.change(editSelect, { target: { value: "cred-1::config-1" } });

    fireEvent.click(within(editForm).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(openApiSpies.updateFeed).toHaveBeenCalledTimes(1));
    const updatePayload = openApiSpies.updateFeed.mock.calls[0][0].feed;
    expect(updatePayload.siteConfigId).toBe("config-1");
    expect(updatePayload.siteLoginCredentialId).toBe("cred-1");
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });

  it("prevents editing the initial lookback after the first poll", async () => {
    const polledFeed = {
      items: [
        {
          ...defaultFeeds.items[0],
          id: "feed-locked",
          pollFrequency: "1h",
          initialLookbackPeriod: "48h",
          lastRssPollAt: "2024-06-01T00:00:00.000Z",
        },
      ],
    };
    openApiSpies.listFeeds.mockResolvedValue(polledFeed);

    renderPage({ feeds: polledFeed });

    const table = await screen.findByRole("table", { name: "Feeds table" });
    const row = within(table).getByText("https://news.example.com/rss").closest("tr") as HTMLTableRowElement;

    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const editForm = await screen.findByRole("form", { name: "Edit Feed" });

    const initialLookbackInput = within(editForm).getByLabelText(
      "Initial lookback (first poll only)",
    ) as HTMLInputElement;
    expect(initialLookbackInput).toBeDisabled();
    expect(initialLookbackInput.value).toBe("48h");
    expect(
      within(editForm).getByText("Initial lookback can only be updated before the first poll runs."),
    ).toBeInTheDocument();

    const pollInput = within(editForm).getByLabelText("Poll frequency (e.g., 1h)") as HTMLInputElement;
    fireEvent.change(pollInput, { target: { value: "2h" } });

    fireEvent.click(within(editForm).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(openApiSpies.updateFeed).toHaveBeenCalledTimes(1));

    const updateArgs = openApiSpies.updateFeed.mock.calls[0][0];
    expect(updateArgs.feed).not.toHaveProperty("initialLookbackPeriod");
  });

  it("closes the edit panel without saving when cancelled", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: "Feeds table" });
    const row = within(table).getByText("https://news.example.com/rss").closest("tr") as HTMLTableRowElement;

    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const editForm = await screen.findByRole("form", { name: "Edit Feed" });
    const pollInput = within(editForm).getByLabelText("Poll frequency (e.g., 1h)") as HTMLInputElement;
    fireEvent.change(pollInput, { target: { value: "30m" } });

    fireEvent.click(within(editForm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit Feed" })).not.toBeInTheDocument());
    expect(openApiSpies.updateFeed).not.toHaveBeenCalled();
  });
});
