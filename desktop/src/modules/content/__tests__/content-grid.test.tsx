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
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  uninstall: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, {
    error: mocks.toastError,
    warning: mocks.toastWarning,
  }),
}))

vi.mock("@/app-shell/identity-context", () => ({
  useRepoProfileMap: () => new Map(),
}))

vi.mock("@/modules/content/components/content-action-split-button", () => ({
  ContentActionSplitButton: () => <button type="button">操作</button>,
}))

vi.mock("@/modules/content/components/skill-env-secret-config-dialog", () => ({
  SkillEnvSecretConfigDialog: ({ item }: { item: SynapseContentMeta<"skill"> }) => (
    <div data-testid="skill-env-config-dialog">{item.title}</div>
  ),
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
  useUninstallFromEditor: () => mocks.uninstall,
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

  it("opens env configuration from the badge without opening the skill card", async () => {
    const { container, onOpenItem } = await renderGrid([
      createContentItem("skill", { id: "env-skill", hasEnv: true, title: "Env Skill" }),
    ])
    const envButton = container.querySelector<HTMLButtonElement>('[aria-label="配置 Env Skill 的环境变量"]')

    expect(envButton?.tagName).toBe("BUTTON")

    await act(async () => {
      envButton?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      envButton?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }))
      envButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="skill-env-config-dialog"]')?.textContent).toBe("Env Skill")
    expect(onOpenItem).not.toHaveBeenCalled()
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

  it("describes editor uninstall as moving content to the system trash", async () => {
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "current-skill",
        name: "review",
      }),
    ])
    const editorButton = container.querySelector<HTMLButtonElement>('button[title="Codex"]')

    await act(async () => {
      editorButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(document.body.textContent).toContain("从 Codex 移到废纸篓？")
    expect(document.body.textContent).toContain("可从系统废纸篓恢复。")
    expect(Array.from(document.body.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "移到废纸篓",
    )).toBe(true)
    expect(document.body.textContent).not.toContain("确认要删除吗")
  })

  it("shows the shared warning when Skill status refresh fails after trashing", async () => {
    mocks.uninstall.mockResolvedValue({ warning: "已移到废纸篓，安装状态刷新失败。" })
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "current-skill",
        name: "review",
      }),
    ])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[title="Codex"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "移到废纸篓")
        ?.click()
      await Promise.resolve()
    })

    expect(mocks.uninstall).toHaveBeenCalledWith("current-skill", "codex")
    expect(mocks.toastWarning).toHaveBeenCalledWith("已移到废纸篓，安装状态刷新失败。")
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
