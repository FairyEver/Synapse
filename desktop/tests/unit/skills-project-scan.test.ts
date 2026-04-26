import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/modules/content/create-content-module", () => ({
  createContentModule: () => function MockContentModule() {
    return React.createElement("div", { "data-module": "skills-library" }, "Skills library")
  },
}))

vi.mock("@/modules/editor-scan", () => ({
  EditorScanModule: ({
    lockedContentTab,
    lockedScopeTab,
    title,
  }: {
    lockedContentTab?: string
    lockedScopeTab?: string
    title?: string
  }) => React.createElement("div", {
    "data-content-tab": lockedContentTab,
    "data-module": "skills-project-scan",
    "data-scope-tab": lockedScopeTab,
  }, title),
}))

describe("Skills project scan entry", () => {
  it("keeps Skills library and exposes project scan", async () => {
    const { SkillsModule } = await import("../../src/modules/skills")

    const html = renderToStaticMarkup(React.createElement(SkillsModule))

    expect(html).toContain("内容库")
    expect(html).toContain("项目扫描")
    expect(html).toContain("data-module=\"skills-library\"")
  })
})
