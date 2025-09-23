import React from "react";
import { render, cleanup } from "@testing-library/react";
import {
  describe,
  it,
  beforeEach,
  beforeAll,
  afterEach,
  vi,
  expect,
} from "vitest";
import { axe } from "jest-axe";
import Home from "../../pages/index";
import Feeds from "../../pages/feeds";
import Bookmarks from "../../pages/bookmarks";
import JobSchedules from "../../pages/job-schedules";
import { I18nProvider } from "../../lib/i18n";

const { routerMock } = vi.hoisted(() => ({ routerMock: { pathname: "/" } }));
const { useSWRMock } = vi.hoisted(() => ({ useSWRMock: vi.fn() }));
const { sessionState } = vi.hoisted(() => ({
  sessionState: {
    data: null as any,
    status: "unauthenticated" as
      | "unauthenticated"
      | "authenticated"
      | "loading",
  },
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: React.forwardRef<HTMLAnchorElement, any>(function LinkMock(
    { href, children, ...rest },
    ref,
  ) {
    const url = typeof href === "string" ? href : (href?.pathname ?? "#");
    return (
      <a ref={ref} href={url} {...rest}>
        {children}
      </a>
    );
  }),
}));

vi.mock("next/router", () => ({
  useRouter: () => routerMock,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: any) => useSWRMock(key),
}));

const createSwrResponse = (data: any) => ({
  data,
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
});

beforeAll(() => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

beforeEach(() => {
  routerMock.pathname = "/";
  useSWRMock.mockReset();
  sessionState.data = null;
  sessionState.status = "unauthenticated";
});

afterEach(() => {
  cleanup();
});

describe("Critical page accessibility", () => {
  it("home page has no detectable accessibility violations", async () => {
    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key)) {
        const [path, param] = key;
        if (path === "/v1/bookmarks/count") {
          return createSwrResponse({ total: 12 });
        }
        if (path === "/v1/jobs") {
          const totals: Record<string, number> = {
            "": 48,
            failed: 2,
            dead: 1,
            queued: 5,
            in_progress: 3,
          };
          return createSwrResponse({
            total: totals[param as keyof typeof totals] ?? 0,
          });
        }
        if (path === "/v1/feeds") {
          return createSwrResponse({ total: 7, items: [] });
        }
        if (path === "/v1/credentials") {
          return createSwrResponse({ total: 4 });
        }
        if (path === "/v1/status") {
          return createSwrResponse({ status: "ok", version: "1.0.0" });
        }
        if (path === "/v1/status/db") {
          return createSwrResponse({
            ok: true,
            details: {
              pg_trgm_enabled: true,
              indexes: { bookmarks: true, feeds: true },
            },
          });
        }
      }
      return createSwrResponse(undefined);
    });

    const { container } = render(
      <I18nProvider>
        <Home />
      </I18nProvider>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("feeds management page has no detectable accessibility violations", async () => {
    routerMock.pathname = "/feeds";

    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key)) {
        const [path] = key;
        if (path === "/v1/feeds") {
          return createSwrResponse({
            items: [
              {
                id: "feed-1",
                url: "https://example.com/rss",
                poll_frequency: "1h",
                initial_lookback_period: "1d",
                is_paywalled: false,
                rss_requires_auth: false,
                site_config_id: "site-123",
              },
            ],
          });
        }
      }
      return createSwrResponse(undefined);
    });

    const { container } = render(
      <I18nProvider>
        <Feeds />
      </I18nProvider>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("bookmarks page has no detectable accessibility violations", async () => {
    routerMock.pathname = "/bookmarks";

    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key)) {
        const [path, , subresource] = key;
        if (path === "/v1/bookmarks" && subresource === "preview") {
          return createSwrResponse("<p>Preview</p>");
        }
        if (path === "/v1/bookmarks") {
          return createSwrResponse({
            items: [
              {
                id: "bookmark-1",
                title: "Accessible Bookmark Title",
                url: "https://example.com/article",
                published_at: "2024-01-01T00:00:00Z",
              },
            ],
            total: 1,
            totalPages: 1,
            hasNext: false,
          });
        }
        if (path === "/v1/feeds") {
          return createSwrResponse({
            items: [{ id: "feed-1", url: "https://example.com/rss" }],
          });
        }
      }
      return createSwrResponse(undefined);
    });

    const { container } = render(
      <I18nProvider>
        <Bookmarks />
      </I18nProvider>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("job schedules page has no detectable accessibility violations", async () => {
    routerMock.pathname = "/job-schedules";
    sessionState.data = {
      user: {
        id: "user-123",
        name: "Test User",
        permissions: ["bookmarks:manage"],
      },
      expires: "2099-01-01T00:00:00.000Z",
    };
    sessionState.status = "authenticated";

    useSWRMock.mockImplementation((key: any) => {
      if (Array.isArray(key)) {
        const [path] = key;
        if (path === "/v1/job-schedules") {
          return createSwrResponse({
            items: [
              {
                id: "schedule-1",
                jobType: "rss_poll",
                payload: {
                  config_dir: "configs/rss",
                  instapaper_id: "cred-1",
                  feed_url: "https://example.com/rss.xml",
                },
                frequency: "1h",
                nextRunAt: new Date("2024-02-01T10:00:00Z"),
                lastRunAt: new Date("2024-01-31T12:00:00Z"),
                lastJobId: "job-123",
                isActive: true,
                ownerUserId: "user-123",
              },
            ],
            total: 1,
            page: 1,
            size: 20,
            hasNext: false,
            totalPages: 1,
          });
        }
        if (path === "/v1/credentials") {
          return createSwrResponse({
            items: [
              {
                id: "cred-1",
                kind: "instapaper",
                description: "Instapaper",
                data: {},
              },
            ],
          });
        }
        if (path === "/v1/site-configs") {
          return createSwrResponse({
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
          });
        }
        if (path === "/v1/feeds") {
          return createSwrResponse({
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
          });
        }
      }
      return createSwrResponse(undefined);
    });

    const { container } = render(
      <I18nProvider>
        <JobSchedules />
      </I18nProvider>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
