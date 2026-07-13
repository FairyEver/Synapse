/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import skillAuthoringGuideMarkdown from "../docs/skill-authoring-guide.md?raw"
import { SkillAuthoringGuideDialog } from "../skill-authoring-guide-dialog"

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("sonner", () => ({ toast: mocks.toast }))
vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

describe("Skill authoring prompt content", () => {
  it("contains the shared rules and both supported workflows without custom directives", () => {
    expect(skillAuthoringGuideMarkdown).toContain("创建一个新 Skill，或修改当前目录中的已有 Skill")
    expect(skillAuthoringGuideMarkdown).toContain("## 创建新 Skill")
    expect(skillAuthoringGuideMarkdown).toContain("## 修改已有 Skill")
    expect(skillAuthoringGuideMarkdown).toContain("渐进式披露")
    expect(skillAuthoringGuideMarkdown).toContain("[A-Za-z_][A-Za-z0-9_]*")
    expect(skillAuthoringGuideMarkdown).toContain("实际调用参数")
    expect(skillAuthoringGuideMarkdown).toContain("事后把日志脱敏不能消除进程参数中的敏感信息")
    expect(skillAuthoringGuideMarkdown).toContain("dry-run 不依赖 `.env`")
    expect(skillAuthoringGuideMarkdown).toContain("所有实际文件变更")
    expect(skillAuthoringGuideMarkdown).not.toContain(":::synapse-prompt")
  })
})

describe("SkillAuthoringGuideDialog", () => {
  const roots: Root[] = []

  beforeEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    for (const root of roots.splice(0)) root.unmount()
  })

  it("renders and copies the complete prompt with one action", async () => {
    await renderDialog(roots)

    const copyButtons = findButtons("复制完整提示词")
    expect(copyButtons).toHaveLength(1)
    expect(document.body.textContent).toContain("创建新 Skill")
    expect(document.body.textContent).toContain("修改已有 Skill")

    await clickButton(copyButtons[0]!)

    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(skillAuthoringGuideMarkdown)
    expect(mocks.toast.success).toHaveBeenCalledWith("提示词已复制")
  })

  it("reports clipboard failures without logging prompt content", async () => {
    const clipboardError = new Error("permission denied")
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(clipboardError)
    await renderDialog(roots)

    await clickButton(findButtons("复制完整提示词")[0]!)

    expect(mocks.toast.error).toHaveBeenCalledWith("复制失败")
    expect(mocks.logger.error).toHaveBeenCalledWith("Skill authoring prompt copy failed.", {
      errorName: "Error",
      messageLength: clipboardError.message.length,
    })
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("permission denied")
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("创建一个新 Skill")
  })

  it("reports an unavailable clipboard without attempting to copy", async () => {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    await renderDialog(roots)

    await clickButton(findButtons("复制完整提示词")[0]!)

    expect(mocks.toast.error).toHaveBeenCalledWith("复制失败")
    expect(mocks.logger.error).toHaveBeenCalledWith("Skill authoring prompt copy failed.", {
      errorName: "ClipboardUnavailable",
      messageLength: 0,
    })
  })
})

async function renderDialog(roots: Root[]): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SkillAuthoringGuideDialog open onOpenChange={vi.fn()} />)
    await Promise.resolve()
  })
}

function findButtons(label: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button"))
    .filter((button): button is HTMLButtonElement => button.textContent?.trim() === label)
}

async function clickButton(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}
