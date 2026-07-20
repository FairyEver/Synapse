/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContentGrid } from "@/modules/content/components/content-grid"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

const mocks = vi.hoisted(() => ({
  getEditorAdapters: vi.fn(async () => [
    {
      id: "codex",
      label: "Codex",
      order: 1,
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["skill", "rule"],
    },
    {
      id: "cursor",
      label: "Cursor",
      order: 2,
      supportsGlobal: true,
      supportsProject: true,
      supportedContentTypes: ["skill", "rule"],
    },
  ]),
  installSourceToEditorTargets: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  uninstall: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  }),
}))

vi.mock("@/app-shell/content", () => ({
  getEditorAdapters: mocks.getEditorAdapters,
}))

vi.mock("@/app-shell/installers", () => ({
  installSourceToEditorTargets: mocks.installSourceToEditorTargets,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
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

    if (contentId === "multi-stale-skill") {
      return [
        {
          editorId: "codex",
          scope: "global",
          status: "needs_update",
        },
        {
          editorId: "cursor",
          scope: "global",
          status: "needs_update",
        },
      ]
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

async function renderDeletedGrid(
  items: SynapseContentMeta[],
  canManageDeletedItem: (item: SynapseContentMeta) => boolean,
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const onPurgeItem = vi.fn()
  const onRestoreItem = vi.fn()

  await act(async () => {
    root.render(
      <ContentGrid
        busyItemId={null}
        canManageDeletedItem={canManageDeletedItem}
        contentType="skill"
        isDeletedView
        items={items}
        onOpenItem={vi.fn()}
        onPurgeItem={onPurgeItem}
        onRestoreItem={onRestoreItem}
      />,
    )
  })

  return { container, onPurgeItem, onRestoreItem }
}

describe("ContentGrid", () => {
  it("hides restore and purge actions for Skills the current user did not create", async () => {
    const owned = createContentItem("skill", { id: "owned", title: "Owned" })
    const other = createContentItem("skill", { createdBy: "other-user", id: "other", title: "Other" })
    const { container } = await renderDeletedGrid(
      [owned, other],
      (item) => item.createdBy === "user-1",
    )

    const cards = Array.from(container.querySelectorAll(":scope > div > div"))
    expect(cards.find((card) => card.textContent?.includes("Owned"))?.querySelectorAll("button")).toHaveLength(2)
    expect(cards.find((card) => card.textContent?.includes("Other"))?.querySelectorAll("button")).toHaveLength(0)
  })

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

    const badge = Array.from(container.querySelectorAll("[aria-label='更新 review']"))
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

  it("reinstalls a Skill into the selected global install target", async () => {
    mocks.installSourceToEditorTargets.mockResolvedValue({
      results: [{ target: { editorId: "codex", scope: "global" }, status: "installed" }],
    })
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "current-skill",
        name: "review",
      }),
    ])
    const editorButton = container.querySelector<HTMLButtonElement>('[aria-label="在 Codex 中重新安装 review"]')

    await act(async () => {
      editorButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("重新安装 Skill")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).not.toContain("移到废纸篓")
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "重新安装")
        ?.click()
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditorTargets).toHaveBeenCalledWith({
      mode: "reinstall",
      source: {
        description: "Description",
        kind: "skill",
        name: "review",
        origin: "repository",
        repositoryContentId: "current-skill",
        sourceIdentity: "current-skill",
        title: "Title",
      },
      targets: [{ editorId: "codex", scope: "global" }],
    })
    expect(mocks.uninstall).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Skill 已重新安装")
  })

  it("updates the selected outdated global install targets through the Skill installer", async () => {
    mocks.installSourceToEditorTargets.mockResolvedValue({
      results: [{ target: { editorId: "codex", scope: "global" }, status: "installed" }],
    })
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "multi-stale-skill",
        name: "review",
      }),
    ])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="更新 review"]')?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("更新 Skill")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).toContain("Cursor")
    expect(document.body.querySelectorAll('[data-slot="checkbox"][data-state="checked"]')).toHaveLength(3)

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#skill-update-select-all")?.click()
    })
    const updateButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "更新")
    expect(updateButton?.disabled).toBe(true)

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#skill-update-target-codex")?.click()
    })
    await act(async () => {
      updateButton?.click()
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditorTargets).toHaveBeenCalledWith({
      mode: "update",
      source: {
        description: "Description",
        kind: "skill",
        name: "review",
        origin: "repository",
        repositoryContentId: "multi-stale-skill",
        sourceIdentity: "multi-stale-skill",
        title: "Title",
      },
      targets: [{ editorId: "codex", scope: "global" }],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Skill 已更新")
  })

  it("keeps failed Skill updates available for retry without repeating successful targets", async () => {
    mocks.installSourceToEditorTargets
      .mockResolvedValueOnce({
        results: [
          { target: { editorId: "codex", scope: "global" }, status: "installed" },
          { target: { editorId: "cursor", scope: "global" }, status: "failed", error: "目录不可写" },
        ],
      })
      .mockResolvedValueOnce({
        results: [{ target: { editorId: "cursor", scope: "global" }, status: "installed" }],
      })
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "multi-stale-skill",
        name: "review",
      }),
    ])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="更新 review"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "更新")
        ?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("部分更新失败")
    expect(document.body.textContent).toContain("目录不可写")
    expect(document.body.textContent).not.toContain("Codex")

    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "重试失败项")
        ?.click()
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditorTargets).toHaveBeenLastCalledWith({
      mode: "update",
      source: expect.any(Object),
      targets: [{ editorId: "cursor", scope: "global" }],
    })
  })

  it("keeps successful Skill update warnings visible for manual inspection", async () => {
    mocks.installSourceToEditorTargets.mockResolvedValue({
      results: [
        {
          target: { editorId: "codex", scope: "global" },
          status: "installed",
          result: { warning: "旧 Skill 备份需要手动检查" },
        },
        { target: { editorId: "cursor", scope: "global" }, status: "installed" },
      ],
    })
    const { container } = await renderGrid([
      createContentItem("skill", {
        id: "multi-stale-skill",
        name: "review",
      }),
    ])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="更新 review"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "更新")
        ?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("更新完成，需检查")
    expect(document.body.textContent).toContain("旧 Skill 备份需要手动检查")
    expect(document.body.textContent).not.toContain("Cursor")
    expect(document.body.textContent).not.toContain("重试失败项")
  })

  it("keeps Rule uninstall on its existing trash flow", async () => {
    mocks.uninstall.mockResolvedValue({})
    const { container } = await renderGrid([
      createContentItem("rule", {
        id: "current-skill",
        name: "review",
      }),
    ], "rule")

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[title="Codex"]')?.click()
    })

    expect(document.body.textContent).toContain("从 Codex 移到废纸篓？")
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "移到废纸篓")
        ?.click()
      await Promise.resolve()
    })

    expect(mocks.uninstall).toHaveBeenCalledWith("current-skill", "codex")
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
