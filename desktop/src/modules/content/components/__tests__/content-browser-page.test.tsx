/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContentBrowserPage } from "../content-browser-page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  addRecentlyViewed: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  syncRepository: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/app-shell/active-repository-switch", () => ({
  useActiveRepositorySwitch: () => ({
    isSwitchingRepository: false,
    openRepositorySwitchDialog: vi.fn(),
  }),
}))

vi.mock("@/app-shell/content", () => ({
  openContentDetailWindow: vi.fn(),
  openContentEditWindow: vi.fn(),
  purgeContent: vi.fn(),
  restoreContent: vi.fn(),
}))

vi.mock("@/app-shell/identity-context", () => ({
  useCurrentRepoProfile: () => ({
    currentRepoProfileState: { status: "ready" },
  }),
  useIdentity: () => ({
    localIdentityState: { status: "ready", identity: { userId: "user-1" } },
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/app-shell/navigation", () => ({
  requestOpenSettingsStorage: vi.fn(),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: vi.fn(),
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => null,
  useRepositoryActions: () => ({
    syncRepository: mocks.syncRepository,
  }),
  useRepositoryState: () => undefined,
}))

vi.mock("@/app-shell/use-repository-toolbar-state", () => ({
  useRepositoryToolbarState: () => ({
    activityLabel: null,
    pendingPushCount: 0,
    refreshBusy: false,
    refreshDisabled: true,
    refreshTitle: "",
    repositorySwitchDisabled: false,
    repositorySwitchTitle: "",
    showRefresh: false,
    showRepositorySwitch: false,
    syncSnapshot: undefined,
    syncStatus: undefined,
  }),
}))

vi.mock("@/modules/content/hooks/use-content-catalog", () => ({
  useContentCatalog: () => ({
    categories: [],
    error: null,
    isLoading: false,
    items: [],
    refresh: vi.fn(),
    totalCount: 0,
  }),
}))

vi.mock("@/modules/content/hooks/use-content-favorites", () => ({
  useContentFavorites: () => ({
    favoriteIds: [],
  }),
}))

vi.mock("@/modules/content/hooks/use-content-recently-viewed", () => ({
  useContentRecentlyViewed: () => ({
    addRecentlyViewed: mocks.addRecentlyViewed,
    recentlyViewedIds: [],
  }),
}))

vi.mock("@/modules/content/hooks/use-content-sort-order", () => ({
  useContentSortOrder: () => ({
    setSortOrder: vi.fn(),
    sortOrder: "modified-desc",
  }),
}))

vi.mock("@/modules/content/hooks/use-deleted-content", () => ({
  useDeletedContent: () => ({
    count: 0,
    error: null,
    isLoading: false,
    items: [],
    refresh: vi.fn(),
  }),
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("ContentBrowserPage", () => {
  it("shows a local empty state when no repository is active", () => {
    renderPage()

    expect(document.body.textContent).toContain("先选择本地目录")
    expect(document.body.textContent).not.toContain("Cannot read")
    expect(mocks.syncRepository).not.toHaveBeenCalled()
  })
})

function renderPage() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<ContentBrowserPage contentType="rule" />)
  })
}
