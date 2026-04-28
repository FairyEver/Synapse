import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const hookSourcePath = join(__dirname, "../hooks/use-editor-install-status.ts")

describe("content detail install status hook source", () => {
  it("passes content detail data to the editor install status resolver", () => {
    const source = readFileSync(hookSourcePath, "utf8")

    expect(source).toContain("resolveEditorInstallStatus")
    expect(source).toContain("contentId: detail.id")
    expect(source).toContain("contentType: detail.type")
    expect(source).toContain("projects: toStatusProjects(projects)")
    expect(source).toContain("refreshSignal")
    expect(source).toContain("export { useEditorInstallStatus }")
  })
})
