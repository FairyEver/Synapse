/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SkillAuthoringGuideDialog } from "../skill-authoring-guide-dialog"
import { parseSkillAuthoringGuide } from "../skill-authoring-guide"

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

const VALID_GUIDE = [
  "# 指南",
  "",
  ':::synapse-prompt id="upgrade-skill" title="修改现有 Skill"',
  "请检查当前目录中的已有 Skill",
  "第二行保持原样。",
  ":::",
  "",
  "迁移说明。",
  "",
  ':::synapse-prompt id="create-skill" title="创建新 Skill"',
  "请在当前目录创建一个新 Skill。",
  ":::",
].join("\n")

describe("parseSkillAuthoringGuide", () => {
  it("preserves prompt text and returns both supported prompts in order", () => {
    const segments = parseSkillAuthoringGuide(VALID_GUIDE)
    const prompts = segments.filter((segment) => segment.kind === "prompt")

    expect(prompts).toEqual([
      {
        kind: "prompt",
        id: "upgrade-skill",
        title: "修改现有 Skill",
        content: "请检查当前目录中的已有 Skill\n第二行保持原样。",
      },
      {
        kind: "prompt",
        id: "create-skill",
        title: "创建新 Skill",
        content: "请在当前目录创建一个新 Skill。",
      },
    ])
    expect(segments.filter((segment) => segment.kind === "markdown").map((segment) => segment.content).join("\n"))
      .not.toContain(":::synapse-prompt")
  })

  it.each([
    ["missing prompt", VALID_GUIDE.replace(/:::synapse-prompt id="create-skill"[\s\S]*$/, "")],
    ["duplicate prompt", `${VALID_GUIDE}\n${VALID_GUIDE.slice(VALID_GUIDE.indexOf(':::synapse-prompt id="upgrade-skill"'), VALID_GUIDE.indexOf(':::synapse-prompt id="create-skill"'))}`],
    ["unknown prompt", VALID_GUIDE.replace('id="create-skill"', 'id="other-skill"')],
    ["empty prompt", VALID_GUIDE.replace("请在当前目录创建一个新 Skill。\n:::", "   \n:::")],
    ["stray directive marker", `${VALID_GUIDE}\n:::`],
  ])("rejects %s blocks", (_caseName, markdown) => {
    expect(() => parseSkillAuthoringGuide(markdown)).toThrow("Skill 开发指南格式无效。")
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

  it("shows the complete prompts and copies the selected prompt", async () => {
    await renderDialog(roots)

    const copyButtons = findButtons("复制提示词")
    expect(copyButtons).toHaveLength(2)
    expect(document.body.textContent).toContain("请检查当前目录中的已有 Skill")
    expect(document.body.textContent).toContain("请在当前目录创建一个符合 Synapse Skill ENV 配置规范的新 Skill")
    expect(document.body.textContent).not.toContain(":::synapse-prompt")

    await clickButton(copyButtons[0]!)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("请检查当前目录中的已有 Skill"),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith("提示词已复制")
  })

  it("reports clipboard failures without logging prompt content", async () => {
    const clipboardError = new Error("permission denied")
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(clipboardError)
    await renderDialog(roots)

    await clickButton(findButtons("复制提示词")[0]!)

    expect(mocks.toast.error).toHaveBeenCalledWith("复制失败")
    expect(mocks.logger.error).toHaveBeenCalledWith("Skill authoring prompt copy failed.", {
      errorName: "Error",
      messageLength: clipboardError.message.length,
    })
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("permission denied")
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("请检查当前目录")
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
