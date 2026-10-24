/** @vitest-environment jsdom */
import { mount, flush, deferred } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { mailRequest } from "@/lib/mail-api"
import { useDepartmentPicker } from "../use-department-picker"
import type { MailOperationResult } from "@/types/mail"
vi.mock("@/lib/mail-api", () => ({ mailRequest: vi.fn() }))
let picker: ReturnType<typeof useDepartmentPicker>
function Harness() { picker = useDepartmentPicker(); return null }
afterEach(() => vi.useRealTimers())
it("discards an old department response after changing selection or composer identity", async () => {
  vi.useFakeTimers()
  vi.mocked(mailRequest).mockResolvedValue({ items: [] })
  mount(<Harness key="owner-one" />)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  const pending = deferred<MailOperationResult["organizationMembers"]>()
  vi.mocked(mailRequest).mockReturnValueOnce(pending.promise)
  act(() => picker.select({ organizationId: "old", teamId: "team", teamName: "示例", parentId: null, name: "研发", memberCount: 1 }))
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  mount(<Harness key="owner-two" />)
  await act(async () => { pending.resolve({ items: [{ userId: "old", nickname: "旧成员", handle: null, contactEmail: "old@example.com" }], nextCursor: "more" }) }); await flush()
  expect(picker.selected).toBeNull(); expect(picker.members).toBeNull()
  expect(vi.mocked(mailRequest).mock.calls.some(([operation]) => operation.kind === "organizationMembers" && operation.cursor === "more")).toBe(false)
})
