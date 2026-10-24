/** @vitest-environment jsdom */
import { mount, flush } from "./harness"
import { act } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { mailRequest } from "@/lib/mail-api"
import { DepartmentPicker } from "../department-picker"
vi.mock("@/lib/mail-api", () => ({ mailRequest: vi.fn() }))
afterEach(() => vi.useRealTimers())
it("requires an explicit exclusion before adding a department with missing contact email", async () => {
  vi.useFakeTimers()
  vi.mocked(mailRequest).mockResolvedValueOnce({ items: [{ organizationId: "org", teamId: "team", teamName: "示例团队", parentId: null, name: "研发", memberCount: 2 }] }).mockResolvedValueOnce({ items: [
    { userId: "one", nickname: "成员甲", handle: null, contactEmail: "one@example.com" },
    { userId: "two", nickname: "新同事", handle: null, contactEmail: null },
  ], nextCursor: null })
  const apply = vi.fn(), close = vi.fn()
  mount(<DepartmentPicker disabled={false} onApply={apply} onClose={close} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) }); await flush()
  const buttons = () => [...document.querySelectorAll("button")]
  act(() => buttons().find(button => button.textContent?.includes("示例团队 / 研发"))!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(1) }); await flush()
  expect(document.body.textContent).toContain("新同事")
  expect(document.body.textContent).toContain("未设置联系邮箱")
  expect(buttons().find(button => button.textContent === "添加收件人")?.disabled).toBe(true)
  expect(apply).not.toHaveBeenCalled()
  act(() => (document.querySelector('[role="checkbox"]') as HTMLElement).click())
  act(() => buttons().find(button => button.textContent === "添加收件人")!.click())
  expect(apply).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ userId: "two", address: null })]), true)
  expect(close).toHaveBeenCalledOnce()
})
