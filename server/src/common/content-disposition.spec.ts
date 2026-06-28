import { describe, expect, it } from "vitest"
import { attachmentContentDisposition, inlineContentDisposition } from "./content-disposition"

describe("content disposition helpers", () => {
  it("builds attachment headers with ASCII fallback and RFC5987 filename", () => {
    expect(attachmentContentDisposition("工作流循环机制调研与头脑风暴.md")).toBe(
      "attachment; filename=\"______________.md\"; filename*=UTF-8''%E5%B7%A5%E4%BD%9C%E6%B5%81%E5%BE%AA%E7%8E%AF%E6%9C%BA%E5%88%B6%E8%B0%83%E7%A0%94%E4%B8%8E%E5%A4%B4%E8%84%91%E9%A3%8E%E6%9A%B4.md",
    )
  })

  it("builds inline headers and percent-encodes RFC5987 special characters", () => {
    expect(inlineContentDisposition("a'b(c)*.txt")).toBe(
      "inline; filename=\"a'b(c)*.txt\"; filename*=UTF-8''a%27b%28c%29%2A.txt",
    )
  })

  it("replaces unsafe ASCII filename fallback characters", () => {
    expect(attachmentContentDisposition("a\"b\\c;d,e\r\n.txt")).toBe(
      "attachment; filename=\"a_b_c_d_e__.txt\"; filename*=UTF-8''a%22b%5Cc%3Bd%2Ce%0D%0A.txt",
    )
  })
})
