import { describe, expect, it } from "vitest"
import { parseDeclaredAppDeepLink } from "../app-deep-link"

describe("parseDeclaredAppDeepLink", () => {
  it("resolves an explicitly declared app action and decodes path once", () => {
    expect(parseDeclaredAppDeepLink(
      "synapse://app/file-opener/open?path=%2Ftmp%2Freport%2520final.docx",
    )).toEqual({
      appId: "file-opener",
      action: "open",
      capabilityId: "app.file_opener.file.open",
      params: { path: "/tmp/report%20final.docx" },
    })
  })

  it("resolves the canonical Agent thread route to the existing open capability", () => {
    const deepLink = "synapse://threads/m0D4NOW0yDeagclYK2CiUQ.xrs"
    expect(parseDeclaredAppDeepLink(deepLink)).toEqual({
      appId: "agent",
      action: "open",
      capabilityId: "app.agent.conversation.open",
      params: { deepLink },
    })
  })

  it("rejects the retired Terminal session route", () => {
    expect(() => parseDeclaredAppDeepLink("synapse://terminals/m0D4NOW0yDeagclYK2CiUQ.xrs"))
      .toThrow("不支持该应用操作")
  })

  it.each([
    "synapse://app/agent/open",
    "synapse://app/agent/open?projectId=project-1",
    "synapse://app/agent/open?conversationId=conversation-1",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1&extra=1",
    "synapse://app/agent/open?projectId=project-1&projectId=project-2&conversationId=conversation-1",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1#fragment",
    "synapse://app/agent/open?projectId=project-1&conversationId=conversation-1",
    "synapse://threads",
    "synapse://threads/m0D4NOW0yDeagclYK2CiUQ.xrs?extra=1",
    "synapse://threads/m0D4NOW0yDeagclYK2CiUQ.xrs/extra",
  ])("rejects an invalid Agent conversation link: %s", (url) => {
    expect(() => parseDeclaredAppDeepLink(url)).toThrow()
  })

  it.each([
    "synapse://app/file-opener/open",
    "synapse://app/file-opener/open?path=relative.txt",
    "synapse://app/file-opener/open?path=%2Ftmp%2Fa&path=%2Ftmp%2Fb",
    "synapse://app/file-opener/open?path=%2Ftmp%2Fa&extra=1",
    "synapse://app/file-opener/open/extra?path=%2Ftmp%2Fa",
    "synapse://app/file-opener//open?path=%2Ftmp%2Fa",
    "synapse://user@app/file-opener/open?path=%2Ftmp%2Fa",
    "synapse://app/file-opener/open?path=%2Ftmp%2Fa#fragment",
    "synapse://app/unknown/open?path=%2Ftmp%2Fa",
    "synapse://app/file-opener/unknown?path=%2Ftmp%2Fa",
  ])("rejects an invalid or undeclared link: %s", (url) => {
    expect(() => parseDeclaredAppDeepLink(url)).toThrow()
  })
})
