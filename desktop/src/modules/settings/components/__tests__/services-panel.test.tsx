/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ServicesPanel } from "../services-panel"

vi.mock("../database-settings-panel", () => ({
  DatabaseSettingsPanel: () => <div>数据库设置</div>,
}))

describe("ServicesPanel", () => {
  it("keeps database settings without the legacy MCP section", () => {
    const html = renderToStaticMarkup(<ServicesPanel />)

    expect(html).toContain("数据库设置")
    expect(html).not.toContain("MCP Server")
  })
})
