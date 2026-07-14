/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContentGrid } from "@/modules/content/components/content-grid"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

vi.mock("@/app-shell/identity-context", () => ({
  useRepoProfileMap: () => new Map(),
}))

vi.mock("@/modules/content/components/content-action-split-button", () => ({
  ContentActionSplitButton: () => <button type="button">操作</button>,
}))

vi.mock("@/modules/content/contexts/install-status-context", () => ({
  useInstallStatus: (contentId: string) => {
    if (contentId === "stale-skill") {
      return [{
        editorId: "codex",
        scope: "global",
        status: "needs_update",
      }]
    }

    if (contentId === "current-skill") {
      return [{
        editorId: "codex",
        scope: "global",
        status: "installed",
      }]
    }

    if (contentId === "project-stale-skill") {
      return [{
        editorId: "codex",
        projectName: "Project",
        projectPath: "/project",
        scope: "project",
        status: "needs_update",
      }]
    }

    return []
  },
  useUninstallFromEditor: () => vi.fn(async () => undefined),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function createContentItem(type: SynapseContentType, overrides: Partial<SynapseContentMeta> = {}): SynapseContentMeta {
  return {
    attachmentCount: type === "skill" ? 1 : 0,
    category: "general",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-1",
    createdByDisplayName: "User",
    deleted: false,
    description: "Description",
    icon: "file",
    iconBg: "muted",
    id: `${type}-1`,
    latestHistoryDirname: "20260101000000",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    modifiedBy: "user-1",
    modifiedByDisplayName: "User",
    title: "Title",
    type,
    ...overrides,
  }
}

async function renderGrid(items: SynapseContentMeta[], contentType: SynapseContentType = items[0]?.type ?? "skill") {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const onOpenItem = vi.fn()

  await act(async () => {
    root.render(
      <ContentGrid
        busyItemId={null}
        contentType={contentType}
        isDeletedView={false}
        items={items}
        onOpenItem={onOpenItem}
        onPurgeItem={vi.fn()}
        onRestoreItem={vi.fn()}
      />,
    )
  })

  return { container, onOpenItem }
}

describe("ContentGrid", () => {
  it("opens a skill item when the card body is clicked but keeps nested actions isolated", async () => {
    const { container, onOpenItem } = await renderGrid([
      createContentItem("skill", { name: "agent-tooling" }),
    ])

    const card = container.querySelector<HTMLElement>('[role="button"]')
    expect(card?.textContent).toContain("Title")

    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenItem).toHaveBeenCalledTimes(1)

    const actionButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "操作")

    await act(async () => {
      actionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenItem).toHaveBeenCalledTimes(1)
  })

  it("shows the skill name on skill cards and copies it without opening the item", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const { container, onOpenItem } = await renderGrid([
      createContentItem("skill", { name: "agent-tooling" }),
    ])

    const copyNameButton = container.querySelector<HTMLButtonElement>('[aria-label="复制 Skill 名称"]')
    expect(copyNameButton?.textContent).toContain("agent-tooling")

    await act(async () => {
      copyNameButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(writeText).toHaveBeenCalledWith("agent-tooling")
    expect(mocks.toast).toHaveBeenCalledWith("Skill 名称已复制到剪贴板")
    expect(onOpenItem).not.toHaveBeenCalled()
  })

  it("shows an env badge beside the title only when the skill declares env support", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", { id: "env-skill", hasEnv: true, title: "Env Skill" }),
      createContentItem("skill", { id: "plain-skill", hasEnv: false, title: "Plain Skill" }),
    ])

    const envTitle = Array.from(container.querySelectorAll("p"))
      .find((element) => element.textContent === "Env Skill")
    const plainTitle = Array.from(container.querySelectorAll("p"))
      .find((element) => element.textContent === "Plain Skill")
    const envBadge = envTitle?.parentElement?.querySelector('[data-slot="badge"]')

    expect(envBadge?.textContent).toBe("env")
    expect(envBadge?.getAttribute("data-variant")).toBe("secondary")
    expect(plainTitle?.parentElement?.querySelector('[data-slot="badge"]')).toBeNull()
  })

  it("does not show the skill name row on prompt cards", async () => {
    const { container } = await renderGrid([
      createContentItem("prompt", { hasEnv: true, name: "prompt-name" }),
    ], "prompt")

    expect(container.querySelector('[aria-label="复制 Skill 名称"]')).toBeNull()
    expect(container.textContent).not.toContain("prompt-name")
    expect(container.textContent).not.toContain("env")
  })

  it("shows update badge in the install status footer when an installed skill is stale", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "stale-skill",
        name: "review",
      }),
    ])

    const badge = Array.from(container.querySelectorAll("[title='已安装版本落后']"))
      .find((element) => element.textContent === "可更新")

    expect(badge).toBeTruthy()
  })

  it("does not show update badge for current installed skills", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "current-skill",
        name: "review",
      }),
    ])

    expect(container.textContent).not.toContain("可更新")
  })

  it("does not show update badge when only project installs are stale", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "project-stale-skill",
        name: "review",
      }),
    ])

    expect(container.textContent).not.toContain("可更新")
  })
})
