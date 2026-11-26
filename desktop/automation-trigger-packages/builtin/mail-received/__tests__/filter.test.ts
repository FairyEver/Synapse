import { describe, expect, it } from "vitest"
import {
  hasMailReceivedFilters,
  isReplyOrForwardMail,
  matchesMailReceivedEvent,
  matchesMailReceivedMetadata,
  summarizeMailReceivedConfig,
} from "../filter"
import { mailReceivedConfigSchema } from "../schema"

describe("mail-received metadata pre-filter", () => {
  it("accepts optional senderMatches, subjectContains, and originalOnly while rejecting unknown fields", () => {
    expect(mailReceivedConfigSchema.parse({
      accountId: "ma_1",
      senderMatches: [" @world-tech.com.cn ", "alice@example.com"],
      subjectContains: [" 部署 "],
      originalOnly: true,
    })).toEqual({
      accountId: "ma_1",
      senderMatches: ["@world-tech.com.cn", "alice@example.com"],
      subjectContains: ["部署"],
      originalOnly: true,
    })
    expect(mailReceivedConfigSchema.safeParse({ senderMatches: [] }).success).toBe(false)
    expect(mailReceivedConfigSchema.safeParse({ subjectContains: ["   "] }).success).toBe(false)
    expect(mailReceivedConfigSchema.safeParse({ subject: "部署" }).success).toBe(false)
  })

  it("matches sender domain with or without leading @ and prevents suffix spoofing", () => {
    const config = { senderMatches: ["@world-tech.com.cn", "partner.io", "boss@external.org"] }
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["ChenP@WORLD-TECH.COM.CN"],
      subject: "财务系统部署申请",
      hasReferences: false,
    })).toBe(true)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["dev@partner.io"],
      subject: "test",
      hasReferences: false,
    })).toBe(true)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["boss@external.org"],
      subject: "test",
      hasReferences: false,
    })).toBe(true)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["attacker@evilworld-tech.com.cn"],
      subject: "财务系统部署申请",
      hasReferences: false,
    })).toBe(false)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["other@external.org"],
      subject: "test",
      hasReferences: false,
    })).toBe(false)
  })

  it("matches subject keywords case-insensitively with NFKC normalization", () => {
    const config = { subjectContains: ["部署", "Portal"] }
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["a@world-tech.com.cn"],
      subject: "财务系统部署申请",
      hasReferences: false,
    })).toBe(true)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["a@world-tech.com.cn"],
      subject: "ＰＯＲＴＡＬ 发布",
      hasReferences: false,
    })).toBe(true)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["a@world-tech.com.cn"],
      subject: "周报汇总",
      hasReferences: false,
    })).toBe(false)
  })

  it("filters replies and forwards when originalOnly is true", () => {
    expect(isReplyOrForwardMail("Re: 财务系统部署申请", false)).toBe(true)
    expect(isReplyOrForwardMail("回复：财务系统部署申请", false)).toBe(true)
    expect(isReplyOrForwardMail("答复: 资产系统申请部署", false)).toBe(true)
    expect(isReplyOrForwardMail("Fwd: 财务系统部署申请", false)).toBe(true)
    expect(isReplyOrForwardMail("转发：财务系统部署申请", false)).toBe(true)
    expect(isReplyOrForwardMail("财务系统部署申请", true)).toBe(true)
    expect(isReplyOrForwardMail("财务系统部署申请", false)).toBe(false)

    const config = {
      senderMatches: ["@world-tech.com.cn"],
      subjectContains: ["部署"],
      originalOnly: true,
    }
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["chenp@world-tech.com.cn"],
      subject: "财务系统部署申请",
      hasReferences: false,
    })).toBe(true)
    expect(matchesMailReceivedMetadata(config, {
      fromAddresses: ["fanxw@world-tech.com.cn"],
      subject: "回复：财务系统部署申请",
      hasReferences: true,
    })).toBe(false)
  })

  it("keeps public summary safe without exposing raw sender addresses or subject keywords", () => {
    expect(hasMailReceivedFilters({})).toBe(false)
    expect(summarizeMailReceivedConfig({})).toBe("全部邮箱账号")
    expect(summarizeMailReceivedConfig({ accountId: "ma_1" })).toBe("指定邮箱账号")
    const summary = summarizeMailReceivedConfig({
      accountId: "ma_1",
      senderMatches: ["@world-tech.com.cn"],
      subjectContains: ["部署"],
      originalOnly: true,
    })
    expect(summary).toBe("指定邮箱账号 · 已设 3 项筛选")
    expect(summary).not.toContain("world-tech")
    expect(summary).not.toContain("部署")
  })

  it("evaluates runtime trigger events consistently", () => {
    const config = { senderMatches: ["@world-tech.com.cn"], subjectContains: ["部署"], originalOnly: true }
    expect(matchesMailReceivedEvent(config, {
      source: "mail",
      type: "message.received",
      receivedAt: "2026-11-26T00:00:00Z",
      payload: { subject: "财务系统部署申请", senderAddresses: JSON.stringify(["chenp@world-tech.com.cn"]) },
    })).toBe(true)
    expect(matchesMailReceivedEvent(config, {
      source: "mail",
      type: "message.received",
      receivedAt: "2026-11-26T00:00:00Z",
      payload: { subject: "Re: 财务系统部署申请", senderAddresses: JSON.stringify(["fanxw@world-tech.com.cn"]) },
    })).toBe(false)
  })
})
