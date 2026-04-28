import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const hookSourcePath = join(__dirname, "../hooks/use-editor-install-status.ts")
const detailDialogSourcePath = join(__dirname, "../components/content-detail-dialog.tsx")
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

  it("wires install status into the content detail dialog only", () => {
    const detailDialogSource = readFileSync(detailDialogSourcePath, "utf8")
    const detailWindowPageSource = readFileSync(detailWindowPageSourcePath, "utf8")

    expect(detailDialogSource).toContain("useEditorInstallStatus")
    expect(detailDialogSource).toContain("EditorInstallStatusPanel")
    expect(detailDialogSource).toContain("installTargetRequest")
    expect(detailDialogSource).toContain("onInstalled={handleInstallStatusRefresh}")
    expect(detailDialogSource).toContain("onOpenInstallTarget")
    expect(detailDialogSource).toContain("config.global.projects")
    expect(detailWindowPageSource).not.toContain("EditorInstallStatusPanel")
  })
})
