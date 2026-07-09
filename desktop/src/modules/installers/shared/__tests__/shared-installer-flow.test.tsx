/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EditorWriteTargetSelection } from "@/modules/content/components/editor-write-target-selector"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type { SynapseInstallerSource, SynapseRuleInstallerSource, SynapseSkillInstallerSource } from "@/types/installers"
import { SharedInstallerFlow } from "../shared-installer-flow"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  config: {
    global: {
      projects: [],
      variables: [{ name: "GITEE_TOKEN", value: "saved-token", description: "saved" }],
    },
  },
  installSourceToEditor: vi.fn(),
  readContent: vi.fn(),
  resolveEditorInstallTarget: vi.fn(),
  readyTargetOverrides: {} as Record<string, unknown>,
  secrets: {
    list: vi.fn(),
    get: vi.fn(),
    upsert: vi.fn(),
  },
  updateConfig: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("@/app-shell/content", () => ({
  readContent: mocks.readContent,
  resolveEditorInstallTarget: mocks.resolveEditorInstallTarget,
}))

vi.mock("@/app-shell/installers", () => ({
  installSourceToEditor: mocks.installSourceToEditor,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.config,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    warning: mocks.warning,
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "secrets") return mocks.secrets
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/components/editor-icon", () => ({
  EditorIcon: ({ editorId }: { editorId: string }) => (
    <span aria-hidden="true" data-testid={`editor-icon-${editorId}`} />
  ),
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFrameBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFrameFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogFrameHeader: ({ title, description }: { title: ReactNode; description?: ReactNode }) => (
    <header>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/definitions/generated/renderer-registry", () => ({
  installFormDefinitionByEditorId: new Map([
    ["codex", {
      RuleGlobalInstallForm: ({
        onConfirm,
        open,
      }: {
        onConfirm: (values: Record<string, unknown>) => void
        open: boolean
      }) => open ? (
        <section>
          <h2>规则元数据</h2>
          <button type="button" onClick={() => onConfirm({ description: "from form" })}>
            确定并安装
          </button>
        </section>
      ) : null,
      RuleProjectInstallForm: ({
        onConfirm,
        open,
      }: {
        onConfirm: (values: Record<string, unknown>) => void
        open: boolean
      }) => open ? (
        <section>
          <h2>规则元数据</h2>
          <button type="button" onClick={() => onConfirm({ description: "from form" })}>
            确定并安装
          </button>
        </section>
      ) : null,
    }],
  ]),
}))

vi.mock("@/modules/content/components/editor-write-target-selector", () => ({
  EditorWriteTargetSelector: ({
    contentType,
    initialSelection,
    onSelectionChange,
  }: {
    contentType: "rule" | "skill"
    initialSelection?: { projectPath?: string; scope: "global" | "project" } | null
    onSelectionChange: (selection: EditorWriteTargetSelection) => void
  }) => (
    <div>
      <span data-testid="initial-selection">
        {initialSelection ? `${initialSelection.scope}:${initialSelection.projectPath ?? ""}` : "none"}
      </span>
      <button
        type="button"
        onClick={() => {
          const targetKind = contentType === "skill" ? "directory" as const : "file" as const
          const scope = initialSelection?.scope ?? "global"
          const projectPath = initialSelection?.projectPath ?? ""
          const activeTarget = {
            contentType,
            editorId: "codex" as SynapseEditorAdapterSummary["id"],
            label: "Codex",
            message: null,
            scope,
            status: "ready" as const,
            targetExists: false,
            targetKind,
            targetPath: targetKind === "directory" ? "/tmp/skills/demo" : "/tmp/rules/demo.md",
            ...mocks.readyTargetOverrides,
          }
          onSelectionChange({
            activeTarget,
            activeTargetState: {
              error: null,
              isLoading: false,
              value: activeTarget,
            },
            projectPath,
            scope,
          })
        }}
      >
        选择目标
      </button>
    </div>
  ),
}))

const editor: SynapseEditorAdapterSummary = {
  id: "codex" as SynapseEditorAdapterSummary["id"],
  label: "Codex",
  order: 1,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill", "prompt"],
}

const ruleSource: SynapseRuleInstallerSource = {
  kind: "rule",
  origin: "inline",
  sourceIdentity: "inline-rule:abc",
  inlineSourceId: "source-1",
  name: "team.rule",
  body: "# Rule",
}

const repositorySkillSource: SynapseSkillInstallerSource = {
  kind: "skill",
  origin: "repository",
  repositoryContentId: "skill-1",
  sourceIdentity: "skill-1",
  name: "demo",
  title: "Demo",
}

let roots: Root[] = []

function resetMockState() {
  mocks.config.global.projects = []
  mocks.config.global.variables = [{ name: "GITEE_TOKEN", value: "saved-token", description: "saved" }]
  mocks.secrets.list.mockResolvedValue({
    secrets: [{ id: "secret-1", name: "GITEE_TOKEN", description: "saved", hasValue: true }],
    total: 1,
  })
  mocks.secrets.get.mockResolvedValue({
    id: "secret-1",
    name: "GITEE_TOKEN",
    description: "saved",
    hasValue: true,
    value: "saved-token",
  })
  mocks.secrets.upsert.mockResolvedValue({
    id: "secret-1",
    name: "GITEE_TOKEN",
    hasValue: true,
  })
  mocks.readyTargetOverrides = {}
}

beforeEach(() => {
  resetMockState()
})

async function renderFlow(
  source: SynapseInstallerSource = ruleSource,
  projects: SynapseProjectConfig[] = mocks.config.global.projects,
  onInstalled: () => Promise<void> | void = vi.fn(),
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <SharedInstallerFlow
        mode="modal"
        source={source}
        editors={[editor]}
        projects={projects}
        onCancel={vi.fn()}
        onInstalled={onInstalled}
      />,
    )
  })
}

async function renderFlowWithInitialTarget() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <SharedInstallerFlow
        mode="modal"
        source={ruleSource}
        editors={[editor]}
        initialEditor={editor}
        initialSelection={{ scope: "project", projectPath: "/tmp/project" }}
        projects={[{ id: "project-1", name: "Project", path: "/tmp/project" }]}
        onCancel={vi.fn()}
        onInstalled={vi.fn()}
      />,
    )
  })
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text))

  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

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

describe("SharedInstallerFlow", () => {
  it("starts embedded sources at editor selection", async () => {
    mocks.resolveEditorInstallTarget.mockResolvedValue({
      editorId: "codex",
      label: "Codex",
      scope: "global",
      contentType: "rule",
      message: null,
      status: "ready",
      targetKind: "file",
      targetPath: "/tmp/rules/team.rule.md",
      targetExists: false,
    })
    await renderFlow()

    expect(document.body.textContent).toContain("选择编辑器")
    expect(document.querySelector("[data-testid='editor-icon-codex']")).not.toBeNull()
    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("目标位置")
  })

  it("starts at the original target when an initial editor is provided", async () => {
    await renderFlowWithInitialTarget()

    expect(document.body.textContent).toContain("目标位置")
    expect(document.body.textContent).not.toContain("选择编辑器")
    expect(document.querySelector("[data-testid='initial-selection']")?.textContent).toBe("project:/tmp/project")
  })

  it("asks for repository Skill variables before install and passes substitutions", async () => {
    mocks.readContent.mockResolvedValue({ content: "```text\nGITEE_TOKEN=${{ GITEE_TOKEN }}\n```" })
    mocks.installSourceToEditor.mockResolvedValue({ targetPath: "/tmp/skills/demo" })
    await renderFlow(repositorySkillSource)

    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("选择目标")
    })
    await act(async () => {
      clickButton("安装")
    })

    expect(document.body.textContent).toContain("变量替换")
    expect(document.body.textContent).toContain("${{ GITEE_TOKEN }}")
    const input = document.querySelector<HTMLInputElement>("input")
    expect(input?.value).toBe("saved-token")
    expect(mocks.secrets.list).toHaveBeenCalled()
    expect(mocks.secrets.get).toHaveBeenCalledWith({ name: "GITEE_TOKEN", includeValue: true })
    expect(mocks.installSourceToEditor).not.toHaveBeenCalled()

    await act(async () => {
      clickButton("继续安装")
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(expect.objectContaining({
      variableSubstitutions: { GITEE_TOKEN: "saved-token" },
    }))
  })

  it("keeps placeholders when submitted variable values are empty", async () => {
    mocks.config.global.variables = []
    mocks.secrets.list.mockResolvedValue({ secrets: [], total: 0 })
    mocks.readContent.mockResolvedValue({ content: "GITEE_TOKEN=${{ GITEE_TOKEN }}" })
    mocks.installSourceToEditor.mockResolvedValue({ targetPath: "/tmp/skills/demo" })
    await renderFlow(repositorySkillSource)

    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("选择目标")
    })
    await act(async () => {
      clickButton("安装")
    })
    await act(async () => {
      clickButton("继续安装")
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(expect.not.objectContaining({
      variableSubstitutions: expect.anything(),
    }))
  })

  it("saves new variables before continuing install", async () => {
    mocks.config.global.variables = []
    mocks.secrets.list.mockResolvedValue({ secrets: [], total: 0 })
    mocks.readContent.mockResolvedValue({ content: "GITEE_TOKEN=${{ GITEE_TOKEN }}" })
    mocks.updateConfig.mockResolvedValue(undefined)
    mocks.installSourceToEditor.mockResolvedValue({ targetPath: "/tmp/skills/demo" })
    await renderFlow(repositorySkillSource)

    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("选择目标")
    })
    await act(async () => {
      clickButton("安装")
    })

    const input = document.querySelector<HTMLInputElement>("input")
    await act(async () => {
      if (input) setInputValue(input, "new-token")
    })
    await act(async () => {
      clickButton("继续安装")
    })

    expect(document.body.textContent).toContain("保存密钥")

    await act(async () => {
      clickButton("保存并继续")
      await Promise.resolve()
    })

    expect(mocks.secrets.upsert).toHaveBeenCalledWith({ name: "GITEE_TOKEN", value: "new-token" })
    expect(mocks.updateConfig).not.toHaveBeenCalledWith(expect.objectContaining({
      global: expect.objectContaining({ variables: expect.any(Array) }),
    }))
    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(expect.objectContaining({
      variableSubstitutions: { GITEE_TOKEN: "new-token" },
    }))
  })

  it("passes rule install form values through the shared installer", async () => {
    const projectEditor = {
      ...editor,
      id: "codex" as SynapseEditorAdapterSummary["id"],
    }
    mocks.installSourceToEditor.mockResolvedValue({ targetPath: "/tmp/rules/demo.md" })
    await renderFlow(ruleSource, [{ id: "project-1", name: "Project", path: "/tmp/project" }])

    void projectEditor
    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("选择目标")
    })
    await act(async () => {
      clickButton("安装")
    })

    expect(document.body.textContent).toContain("规则元数据")

    await act(async () => {
      clickButton("确定并安装")
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(expect.objectContaining({
      installFormValues: { description: "from form" },
    }))
  })

  it("reinstalls into an owned Skill directory without asking for overwrite confirmation", async () => {
    mocks.readyTargetOverrides = {
      ownedTargetExists: true,
      targetExists: true,
    }
    mocks.readContent.mockResolvedValue({ content: "# Demo" })
    mocks.installSourceToEditor.mockResolvedValue({ targetPath: "/tmp/skills/demo" })
    await renderFlow(repositorySkillSource)

    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("选择目标")
    })
    await act(async () => {
      clickButton("安装")
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("确认覆盖目标目录？")
    expect(mocks.installSourceToEditor).toHaveBeenCalledWith(expect.objectContaining({
      overwriteConfirmed: false,
    }))
  })

  it("retries completion without repeating local editor writes", async () => {
    const onInstalled = vi.fn()
      .mockRejectedValueOnce(new Error("完成记录失败"))
      .mockResolvedValueOnce(undefined)
    mocks.readContent.mockResolvedValue({ content: "# Demo" })
    mocks.installSourceToEditor.mockResolvedValue({ targetPath: "/tmp/skills/demo" })
    await renderFlow(repositorySkillSource, mocks.config.global.projects, onInstalled)

    await act(async () => {
      clickButton("Codex")
      await Promise.resolve()
    })
    await act(async () => {
      clickButton("选择目标")
    })
    await act(async () => {
      clickButton("安装")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledTimes(1)
    expect(onInstalled).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("完成记录失败")
    expect(document.body.textContent).toContain("重试完成记录")

    await act(async () => {
      clickButton("重试完成记录")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.installSourceToEditor).toHaveBeenCalledTimes(1)
    expect(onInstalled).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("安装完成")
  })
})
