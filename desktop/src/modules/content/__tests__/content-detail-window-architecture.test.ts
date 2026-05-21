import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildSkillFileTree } from "@/modules/content/components/content-detail-window-layout"

const browserPageSourcePath = join(__dirname, "../components/content-browser-page.tsx")
const detailWindowPageSourcePath = join(__dirname, "../components/content-detail-window-page.tsx")
const skillVersionViewSourcePath = join(__dirname, "../../skills/components/skill-version-view.tsx")

describe("content detail window architecture", () => {
  it("opens content cards in a dedicated detail window instead of selecting an in-page dialog item", () => {
    const source = readFileSync(browserPageSourcePath, "utf8")

    expect(source).toContain("openContentDetailWindow")
    expect(source).toContain("handleOpenItemInWindow")
    expect(source).toContain("await openContentDetailWindow({")
    expect(source).toContain("onOpenItem={(item) => {")
    expect(source).toContain("void handleOpenItemInWindow(item)")
  })

  it("keeps resource-specific detail window pages assembled from shared window components", () => {
    const source = readFileSync(detailWindowPageSourcePath, "utf8")

    expect(source).toContain("ContentDetailWindowShell")
    expect(source).toContain("ContentDetailWindowSummary")
    expect(source).toContain("ContentDetailWindowMain")
    expect(source).toContain("SkillFileSidebar")
    expect(source).toContain("MAIN_SKILL_FILE_PATH")
    expect(source).toContain("function RuleDetailWindowPage")
    expect(source).toContain("function PromptDetailWindowPage")
    expect(source).toContain("function SkillDetailWindowPage")
  })

  it("loads selected Skill attachments into the right-side preview pane", () => {
    const source = readFileSync(detailWindowPageSourcePath, "utf8")

    expect(source).toContain("readAttachmentFile")
    expect(source).toContain("SkillAttachmentPreview")
    expect(source).toContain("resolveSkillAttachmentPreview")
    expect(source).toContain("activeFilePath === MAIN_SKILL_FILE_PATH")
  })

  it("keeps the edit dialog available from dedicated detail windows", () => {
    const source = readFileSync(detailWindowPageSourcePath, "utf8")
    const layoutSource = readFileSync(join(__dirname, "../components/content-detail-window-layout.tsx"), "utf8")

    expect(source).toContain("useContentWindowEditState")
    expect(source).toContain("RuleCreateDialog")
    expect(source).toContain("PromptCreateDialog")
    expect(source).toContain("SkillCreateDialog")
    expect(layoutSource).toContain("canEdit={canEdit}")
    expect(layoutSource).toContain("onEdit={onEdit}")
  })

  it("builds a cross-platform hierarchical Skill file tree from attachment paths", () => {
    const tree = buildSkillFileTree([
      {
        originalName: "references/checklist.md",
        sha256: "a",
        size: 12,
      },
      {
        originalName: "scripts\\audit.ts",
        sha256: "b",
        size: 24,
      },
      {
        originalName: "README.md",
        sha256: "c",
        size: 36,
      },
    ])

    expect(tree.map((node) => `${node.type}:${node.path}`)).toEqual([
      "directory:references",
      "directory:scripts",
      "file:README.md",
      "file:SKILL.md",
    ])
    expect(tree[0]?.children.map((node) => node.path)).toEqual(["references/checklist.md"])
    expect(tree[1]?.children.map((node) => node.path)).toEqual(["scripts/audit.ts"])
  })

  it("does not render the legacy attachment list in Skill content previews", () => {
    const source = readFileSync(skillVersionViewSourcePath, "utf8")

    expect(source).not.toContain("formatSkillAttachmentSize")
    expect(source).not.toContain("version.attachments.map")
    expect(source).not.toContain("没有附件。")
  })
})
