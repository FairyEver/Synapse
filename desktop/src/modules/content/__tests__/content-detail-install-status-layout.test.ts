import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const hookSourcePath = join(__dirname, "../hooks/use-editor-install-status.ts")
const adaptersHookSourcePath = join(__dirname, "../hooks/use-editor-adapters-for-content-type.ts")
const detailMenubarSourcePath = join(__dirname, "../components/content-detail-menubar.tsx")
const detailWindowPageSourcePath = join(__dirname, "../components/content-detail-window-page.tsx")

describe("content detail install status hook source", () => {
  it("passes content detail data to the editor install status resolver", () => {
    const source = readFileSync(hookSourcePath, "utf8")

    expect(source).toContain("resolveEditorInstallStatus")
    expect(source).toContain("contentId: detail.id")
    expect(source).toContain("contentType: detail.type")
    expect(source).toContain("projects: toStatusProjects(projects)")
    expect(source).toContain("refreshSignal")
    expect(source).toContain("isInstallableContentDetail")
    expect(source).toContain("requestSeqRef")
    expect(source).toContain("export { useEditorInstallStatus }")
  })

  it("keeps install status panel support out of dedicated detail window pages", () => {
    const detailMenubarSource = readFileSync(detailMenubarSourcePath, "utf8")
    const detailWindowPageSource = readFileSync(detailWindowPageSourcePath, "utf8")
    const adaptersHookSource = readFileSync(adaptersHookSourcePath, "utf8")

    expect(detailMenubarSource).toContain("EditorInstallStatusPanel")
    expect(adaptersHookSource).toContain("loadPromiseRef")
    expect(detailMenubarSource).toContain("warning(")
    expect(detailMenubarSource).toContain("未找到可用的安装目标。")
    expect(detailWindowPageSource).toContain("ContentDetailWindowSummary")
    expect(detailWindowPageSource).not.toContain("EditorInstallStatusPanel")
  })

  it("does not expose copy actions in Skill detail toolbars", () => {
    const detailMenubarSource = readFileSync(detailMenubarSourcePath, "utf8")

    expect(detailMenubarSource).toContain("canCopyInDetailToolbar")
    expect(detailMenubarSource).toContain("item.type !== \"skill\"")
    expect(detailMenubarSource).toContain("canCopyInDetailToolbar ?")
  })
})
