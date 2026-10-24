import { beforeEach, expect, it, vi } from "vitest"
import { mailRequest } from "@/lib/mail-api"
import { departmentMember, mergeDepartmentAddresses, resolveDepartment } from "../department-recipients"
vi.mock("@/lib/mail-api", () => ({ mailRequest: vi.fn() }))
const request = vi.mocked(mailRequest)
const member = (userId: string, contactEmail: string | null) => ({ userId, nickname: userId, handle: null, contactEmail })
beforeEach(() => request.mockReset())
it("reads all member pages and never returns partial data when a later page fails", async () => {
  request.mockResolvedValueOnce({ items: [member("one", "one@example.com")], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [member("two", null)], nextCursor: null })
  expect(await resolveDepartment("org")).toHaveLength(2)
  expect(request).toHaveBeenLastCalledWith({ kind: "organizationMembers", organizationId: "org", cursor: "next" })
  request.mockResolvedValueOnce({ items: [member("one", "one@example.com")], nextCursor: "next" }).mockRejectedValueOnce(new Error("offline"))
  await expect(resolveDepartment("org")).rejects.toThrow("offline")
})
it("fails closed on repeated cursors and cancels after the identity or selection changes", async () => {
  request.mockResolvedValue({ items: [], nextCursor: "same" })
  await expect(resolveDepartment("org")).rejects.toThrow("分页异常")
  let current = true
  request.mockImplementationOnce(async () => { current = false; return { items: [], nextCursor: null } })
  await expect(resolveDepartment("org", () => current)).rejects.toThrow("取消")
})
it("does not substitute a login email or silently skip missing and invalid contact emails", () => {
  const missing = departmentMember({ ...member("new", null), email: "login@example.com" } as ReturnType<typeof member>)
  const invalid = departmentMember(member("invalid", "bad"))
  const valid = departmentMember(member("valid", "contact@example.com"))
  expect(missing.address).toBeNull(); expect(missing.issue).toBe("未设置联系邮箱")
  expect(invalid.issue).toBe("联系邮箱格式无效")
  expect(() => mergeDepartmentAddresses([], [], "to", [missing, valid], false)).toThrow("请先处理")
  expect(mergeDepartmentAddresses([], [], "to", [missing, valid], true).to).toEqual([valid.address])
  expect(() => mergeDepartmentAddresses([], [], "to", [missing], true)).toThrow("没有可用")
})
it("deduplicates overlapping departments and gives To priority over Cc", () => {
  const members = [departmentMember(member("one", "same@example.com")), departmentMember(member("two", "SAME@example.com"))]
  expect(mergeDepartmentAddresses([], [{ address: "same@example.com" }], "to", members, false)).toEqual({ to: [members[0].address], cc: [] })
  expect(mergeDepartmentAddresses([{ address: "same@example.com" }], [], "cc", members, false)).toEqual({ to: [{ address: "same@example.com" }], cc: [] })
})
it("rejects over-limit recipient expansion instead of truncating", () => {
  const members = Array.from({ length: 501 }, (_, i) => departmentMember(member(String(i), `user${i}@example.com`)))
  expect(() => mergeDepartmentAddresses([], [], "to", members, false)).toThrow("500")
})
