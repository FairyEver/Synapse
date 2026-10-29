import { describe, expect, it } from "vitest"
import { formatDriveHistoryVisitTime } from "../drive-history-time"

const now = new Date(2026, 9, 29, 15, 0)
const at = (value: string) => formatDriveHistoryVisitTime(value, { filtered: false, now })
const filteredAt = (value: string) => formatDriveHistoryVisitTime(value, { filtered: true, now })

describe("formatDriveHistoryVisitTime", () => {
  it.each([
    ["2026-10-29T14:59:30", "刚刚"],
    ["2026-10-29T14:40:00", "20分钟前"],
    ["2026-10-29T12:00:00", "3小时前"],
    ["2026-10-29T00:10:00", "14小时前"],
    ["2026-10-28T23:50:00", "23:50"],
    ["2026-10-20T09:15:00", "09:15"],
  ])("shows %s as %s inside day groups", (value, expected) => {
    expect(at(value)).toBe(expected)
  })

  it.each([
    ["2026-10-29T14:59:30", "今天 刚刚"],
    ["2026-10-29T12:00:00", "今天 3小时前"],
    ["2026-10-28T23:50:00", "1天前"],
    ["2026-10-27T09:00:00", "2天前"],
    ["2026-10-23T09:00:00", "6天前"],
    ["2026-10-22T09:00:00", "10月22日"],
    ["2026-10-20T09:00:00", "10月20日"],
  ])("shows %s as %s when searching across days", (value, expected) => {
    expect(filteredAt(value)).toBe(expected)
  })

  it("falls back for invalid timestamps", () => {
    expect(formatDriveHistoryVisitTime("bad-date", { filtered: true, now })).toBe("-")
  })
})
