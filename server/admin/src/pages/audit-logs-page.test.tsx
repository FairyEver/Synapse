import { describe, expect, it } from "vitest"
import { AUDIT_ACTION_FILTER_OPTIONS } from "./audit-logs-page"

describe("AuditLogsPage", () => {
  it("offers known audit actions in the filter", () => {
    expect(AUDIT_ACTION_FILTER_OPTIONS).toEqual(expect.arrayContaining([
      { value: "all", label: "全部操作" },
      { value: "admin.invitation.create", label: "admin.invitation.create" },
      { value: "admin.user.status_update", label: "admin.user.status_update" },
      { value: "team.create", label: "team.create" },
      { value: "backup.download", label: "backup.download" },
    ]))
    expect(AUDIT_ACTION_FILTER_OPTIONS.length).toBeGreaterThan(1)
  })
})
