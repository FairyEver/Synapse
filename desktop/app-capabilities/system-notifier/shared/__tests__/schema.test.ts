import { describe, expect, it } from "vitest"
import {
  validateSystemNotificationInput,
  type SystemNotificationInvalidInput,
} from "../schema"

function invalid(input: unknown): SystemNotificationInvalidInput {
  const result = validateSystemNotificationInput(input)
  if (result.ok) throw new Error("Expected invalid input.")
  return result
}

describe("system notification input", () => {
  it.each([
    "文".repeat(64),
    "😀".repeat(32),
    `${"😀".repeat(31)}中文`,
  ])("accepts exact single-line Unicode titles at 64 UTF-16 code units: %#", (title) => {
    const body = `组合e\u0301${"文".repeat(252)}`
    expect(validateSystemNotificationInput({ title, body })).toEqual({
      ok: true,
      data: { title, body },
    })
  })

  it("keeps the body limit at 256 code points, including 512 UTF-16 code units", () => {
    const body = "😀".repeat(256)
    expect(validateSystemNotificationInput({ title: "标题", body })).toEqual({
      ok: true,
      data: { title: "标题", body },
    })
  })

  it.each([
    [null, "request", "type"],
    [[], "request", "type"],
    [{ title: "标题", body: "正文", source: "tool" }, "request", "unknown_field"],
    [{ body: "正文" }, "title", "required"],
    [{ title: "", body: "正文" }, "title", "required"],
    [{ title: null, body: "正文" }, "title", "type"],
    [{ title: " 标题", body: "正文" }, "title", "leading_or_trailing_whitespace"],
    [{ title: "标题", body: "   " }, "body", "leading_or_trailing_whitespace"],
    [{ title: "\ud800", body: "正文" }, "title", "invalid_unicode"],
    [{ title: "标题\n换行", body: "正文" }, "title", "forbidden_character"],
    [{ title: "标题", body: "正文\u2029分段" }, "body", "forbidden_character"],
    [{ title: "文".repeat(65), body: "正文" }, "title", "too_long"],
    [{ title: `${"😀".repeat(32)}a`, body: "正文" }, "title", "too_long"],
    [{ title: "😀".repeat(33), body: "正文" }, "title", "too_long"],
    [{ title: "标题", body: "文".repeat(257) }, "body", "too_long"],
  ])("returns one stable redacted error for %#", (input, field, reason) => {
    expect(invalid(input)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      error: "Invalid system notification input.",
      data: { field, reason },
    })
  })

  it("uses request, title, body, url, group and field checks in the fixed first-error order", () => {
    expect(invalid({ title: 42, body: "\n", extra: true }).data).toEqual({
      field: "request",
      reason: "unknown_field",
    })
    expect(invalid({ title: 42, body: "\n" }).data).toEqual({
      field: "title",
      reason: "type",
    })
    // url 排在 group 之前：先报链接再报标签，模型一次只会看到一条。
    expect(invalid({ title: "标题", body: "正文", url: "http://x/", group: "" }).data)
      .toEqual({ field: "url", reason: "not_https" })
  })

  it("carries an optional link and group, and omits them when absent", () => {
    expect(validateSystemNotificationInput({
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })).toEqual({
      ok: true,
      data: {
        title: "周报已生成",
        body: "点开查看完整报告",
        group: "云盘分享",
        url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
      },
    })

    // 没传就不出现该键。这里必须是 `toStrictEqual` 而不是 `toEqual`：vitest 的 `toEqual`
    // 忽略值为 `undefined` 的键，一个「永远写出 url/group、但值可能是 undefined」的实现
    // 拿它跑照样绿 —— 那这条断言就没守它声称要守的东西。
    expect(validateSystemNotificationInput({ title: "标题", body: "正文" })).toStrictEqual({
      ok: true,
      data: { title: "标题", body: "正文" },
    })
  })

  it.each([
    [{ title: "标题", body: "正文", url: "http://example.com/x" }, "url", "not_https"],
    [{ title: "标题", body: "正文", url: "ftp://example.com/x" }, "url", "not_https"],
    [{ title: "标题", body: "正文", url: "not a url" }, "url", "not_https"],
    [{ title: "标题", body: "正文", url: "" }, "url", "required"],
    [{ title: "标题", body: "正文", url: 42 }, "url", "type"],
    [{ title: "标题", body: "正文", url: " https://example.com/" }, "url", "leading_or_trailing_whitespace"],
    [{ title: "标题", body: "正文", url: `https://example.com/${"a".repeat(2048)}` }, "url", "too_long"],
    [{ title: "标题", body: "正文", group: "云盘\n分享" }, "group", "forbidden_character"],
    [{ title: "标题", body: "正文", group: " 云盘分享" }, "group", "leading_or_trailing_whitespace"],
    [{ title: "标题", body: "正文", group: "" }, "group", "required"],
    [{ title: "标题", body: "正文", group: "云".repeat(65) }, "group", "too_long"],
    // 33 个 emoji 是 33 个码点、66 个 UTF-16 码元：码点检查放过它，码元检查必须拦下。
    // 服务端 zod 的 `.max(64)` 数的是码元，桌面只数码点就会比服务端宽。
    [{ title: "标题", body: "正文", group: "😀".repeat(33) }, "group", "too_long"],
    [{ title: "标题", body: "正文", group: null }, "group", "type"],
    [{ title: "标题", body: "正文", level: "passive" }, "request", "unknown_field"],
    // body 排在 url 前面：两个都坏时先报 body。没有这一行，一个先校验 url 的实现
    // 能把上面所有行都跑绿。
    [{ title: "标题", body: " 正文", url: "http://x/" }, "body", "leading_or_trailing_whitespace"],
  ])("rejects an unusable link or group at %#", (input, field, reason) => {
    expect(invalid(input).data).toEqual({ field, reason })
  })

  it("accepts values exactly at the limit and rejects the next character", () => {
    // 界内必须放行：把 `>` 写成 `>=` 会让服务端接受的值在这里被拒，
    // 而上面那些用例全都在界限之外，没有一个会因此变红。
    expect(validateSystemNotificationInput({
      title: "标题",
      body: "正文",
      group: "云".repeat(64),
      url: `https://example.com/${"a".repeat(2028)}`,
    })).toMatchObject({ ok: true })
    expect(invalid({ title: "标题", body: "正文", group: "云".repeat(65) }).data)
      .toEqual({ field: "group", reason: "too_long" })
  })

  it("never serializes rejected content or actual lengths", () => {
    const secret = "sk-secret-value"
    const serialized = JSON.stringify(invalid({ title: secret.repeat(20), body: "正文" }))
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(String(secret.length * 20))
  })
})
