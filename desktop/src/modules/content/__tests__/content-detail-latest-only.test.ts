import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("content detail latest-only view", () => {
  it("does not render or wire content history selection", async () => {
    const panelSource = await readFile(
      new URL("../components/content-detail-panel.tsx", import.meta.url),
      "utf8",
    )
    const hookSource = await readFile(
      new URL("../hooks/use-content-detail-state.ts", import.meta.url),
      "utf8",
    )

    expect(panelSource).not.toContain("ContentHistorySelect")
    expect(panelSource).not.toContain("onSelectedHistoryDirnameChange")
    expect(panelSource).not.toContain("selectedHistoryDirname")
    expect(hookSource).not.toContain("readHistory")
    expect(hookSource).not.toContain("readHistoryVersion")
    expect(hookSource).not.toContain("selectedHistoryDirname")
  })

  it("does not pass a requested history version into content detail windows", async () => {
    const browserPageSource = await readFile(
      new URL("../components/content-browser-page.tsx", import.meta.url),
      "utf8",
    )
    const windowParamSource = await readFile(
      new URL("../../../lib/content-window.ts", import.meta.url),
      "utf8",
    )

    expect(browserPageSource).not.toContain("historyDirname: item.latestHistoryDirname")
    expect(windowParamSource).not.toContain("historyDirname")
  })
})
