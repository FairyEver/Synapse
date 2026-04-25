import { describe, expect, it } from "vitest"
import {
  findUnmappedWebAdminEntries,
  renderWebAdminReplacementAuditMarkdown,
  WEB_ADMIN_REPLACEMENT_ENTRIES,
} from "../../electron/services/web-admin-replacement-audit-service"

describe("web admin replacement audit", () => {
  it("maps every old Web Admin route, page, and API source to 3S modules", () => {
    expect(findUnmappedWebAdminEntries()).toEqual([])
    expect(WEB_ADMIN_REPLACEMENT_ENTRIES.map((entry) => entry.source)).toEqual(
      expect.arrayContaining([
        "/",
        "/projects",
        "/providers",
        "/skills",
        "/chat",
        "/cron",
        "/system",
        "/api/v1",
        "Bridge/BridgeAdapters.tsx",
      ]),
    )
  })

  it("renders a non-orphan replacement artifact without reintroducing the old SPA", () => {
    const markdown = renderWebAdminReplacementAuditMarkdown()

    expect(markdown).toContain("| /skills | route | CC-013 | skills module and content services |")
    expect(markdown).toContain("No old Web Admin SPA route is reintroduced.")
    expect(markdown).not.toContain("dropped")
  })
})
