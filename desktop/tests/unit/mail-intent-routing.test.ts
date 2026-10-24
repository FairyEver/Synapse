import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import { searchSynapseTools } from "../../electron/services/agent-runtime/synapse-tool-router"
import corpus from "./mail-intent-corpus.json"

describe("mail natural-language routing", () => {
  it.each(corpus)("$id: $prompt", async ({ prompt, expected, context }) => {
    // A stateless discovery endpoint cannot resolve conversation pronouns. The
    // Skill supplies the already established domain, never guesses message IDs.
    const result = await searchSynapseTools({ query: context ? `邮件 ${prompt}` : prompt, limit: 5 })
    if (expected === null) {
      expect(result.tools).toEqual([])
      expect(result.guidance).toContain("不支持定时发送")
    } else {
      expect(result.tools[0]?.name).toBe(expected)
      expect(result.tools.every(tool => tool.domain === (prompt.includes("站内信") ? "mail_internal" : "mail"))).toBe(true)
    }
  })

  it.each(["给王总发邮件", "看我的邮件", "Synapse 邮件", "邮箱", "收件箱", "send email to alice@example.com", "read my inbox"])("defaults to external mail: %s", async query => {
    const result = await searchSynapseTools({ query, limit: 5 })
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools.every(tool => tool.domain === "mail")).toBe(true)
  })

  it("preserves typed references, canonical names, and domain constraints", async () => {
    expect((await searchSynapseTools({ query: "synapse://mail-internal/example", limit: 1 })).tools[0]?.name).toBe("app_mail_internal_message_get")
    expect((await searchSynapseTools({ query: "app_mail_internal_message_send", limit: 1 })).tools[0]?.name).toBe("app_mail_internal_message_send")
    expect((await searchSynapseTools({ query: "看我的邮件", domain: "drive" })).tools).toEqual([])
    expect((await searchSynapseTools({ query: "看我的通知中心" })).tools.some(tool => tool.domain === "mail_internal")).toBe(false)
    expect((await searchSynapseTools({ query: "消息列表" })).tools.some(tool => tool.domain === "mail_internal")).toBe(false)
  })

  it("does not confuse incoming mail, draft-only, or unsupported operations with sending", async () => {
    for (const query of ["谁发给我的邮件", "帮我拟一段回复，先不要发", "写邮件但不要发送", "找给我发送过邮件的人"]) {
      const result = await searchSynapseTools({ query, limit: 5 })
      expect(result.tools.some(tool => tool.name === "app_mail_message_send")).toBe(false)
    }
    for (const query of ["撤回已发送邮件", "同步邮箱通讯录"]) {
      const result = await searchSynapseTools({ query })
      expect(result.tools).toEqual([])
      expect(result.guidance).toContain("不支持")
    }
  })

  it("keeps email body/subject words and other-channel replies out of unsupported mail routing", async () => {
    for (const query of ["帮我发邮件，内容是明天上午九点发货", "给张三发邮件，主题是如何撤回邮件", "转发那封关于下周发货的邮件", "给张三发邮件，正文是把这些邮件删掉", "给张三发邮件，主题是站内信操作指南"]) {
      const result = await searchSynapseTools({ query, limit: 1 })
      expect(result.tools[0]?.name, query).toBe("app_mail_draft_create")
    }
    for (const query of ["在云盘搜索邮件模板", "回复这条云盘评论"]) {
      const result = await searchSynapseTools({ query, limit: 5 })
      expect(result.tools.some(tool => tool.domain === "mail"), query).toBe(false)
    }
    expect((await searchSynapseTools({ query: "找一下主题是合同的邮件", limit: 1 })).tools[0]?.name).toBe("app_mail_message_list")
  })

  it("keeps all 41 scenarios and account/no-send boundaries in the installed Skill source", async () => {
    expect(corpus).toHaveLength(41)
    const root = new URL("../../app-capabilities/synapse-skill/skill-package/", import.meta.url)
    const guide = await readFile(new URL("mail/index.md", root), "utf8")
    const scenarios = await readFile(new URL("mail/scenarios.md", root), "utf8")
    for (const { id, prompt } of corpus) {
      expect(scenarios, id).toContain(prompt)
    }
    expect(guide).toContain("只有一个")
    expect(guide).toContain("不要询问")
    expect(guide).toContain("sourceMessage")
    expect(guide).toContain("receivedAfter")
    expect(guide).toContain("不支持定时发送")
    expect(guide).toContain("scenarios.md")
  })
})
