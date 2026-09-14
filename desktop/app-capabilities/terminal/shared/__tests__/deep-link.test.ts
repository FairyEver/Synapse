import { describe, expect, it } from "vitest"

import { TERMINAL_SESSION_OPEN_CAPABILITY_ID } from "../capability"
import {
  buildTerminalSessionDeepLink,
  parseTerminalSessionDeepLink,
  terminalSessionProtocolRouteParamsSchema,
} from "../deep-link"
import { terminalCapabilityManifest } from "../manifest"

const SESSION_REFERENCE = "tsr_abcdefghijklmnopqrstuv.abc"
const DEEP_LINK = "synapse://terminals/abcdefghijklmnopqrstuv%2Eabc"

describe("Terminal session deep link", () => {
  it("builds a deterministic encoded local deep link", () => {
    expect(buildTerminalSessionDeepLink({ sessionRef: SESSION_REFERENCE })).toBe(DEEP_LINK)
    expect(buildTerminalSessionDeepLink({ sessionRef: "tsr_abcdefghijklmnopqrstuv.abc" })).toBe(DEEP_LINK)
  })

  it("rejects references that do not carry a checksum body", () => {
    expect(() => buildTerminalSessionDeepLink({ sessionRef: "tsr_abcdefghijklmnopqrstuv" })).toThrow(
      "invalid_terminal_session_reference",
    )
    expect(() => buildTerminalSessionDeepLink({ sessionRef: "agc_abcdefghijklmnopqrstuv.abc" })).toThrow(
      "invalid_terminal_session_reference",
    )
  })

  it("parses its own link back into the local session reference", () => {
    expect(parseTerminalSessionDeepLink(DEEP_LINK)).toEqual({ sessionRef: SESSION_REFERENCE })
  })

  it("tolerates Markdown-escaped separators", () => {
    expect(parseTerminalSessionDeepLink("synapse://terminals/abcdefghijklmnopqrstuv\\.abc")).toEqual({
      sessionRef: SESSION_REFERENCE,
    })
  })

  it("rejects links that are not the declared Terminal route", () => {
    for (const link of [
      "synapse://threads/abcdefghijklmnopqrstuv.abc",
      "synapse://terminals/abcdefghijklmnopqrstuv.abc?session=1",
      "synapse://terminals/abcdefghijklmnopqrstuv.abc#fragment",
      "synapse://terminals/",
      "synapse://terminals/abcdefghijklmnopqrstuv/abc",
      "synapse://user:pass@terminals/abcdefghijklmnopqrstuv.abc",
      "synapse://terminals:8443/abcdefghijklmnopqrstuv.abc",
      "synapse://terminals/abcdefghijklmnopqrstuv.abc ",
      "synapse://terminals/abcdefghijklmnopqrstuv+abc",
      "synapse://terminals/abcdefghijklmnopqrstuv%ZZ.abc",
      "synapse://terminals/abcdefghijklmnopqrstuv.abcdef",
    ]) {
      expect(() => parseTerminalSessionDeepLink(link)).toThrow("invalid_terminal_session_deep_link")
    }
  })

  it("validates protocol route params for the declared open capability", () => {
    expect(terminalSessionProtocolRouteParamsSchema.parse({ deepLink: DEEP_LINK })).toEqual({ deepLink: DEEP_LINK })
    expect(terminalSessionProtocolRouteParamsSchema.safeParse({ deepLink: "synapse://threads/abcdefghijklmnopqrstuv.abc" }).success)
      .toBe(false)
    expect(terminalSessionProtocolRouteParamsSchema.safeParse({ deepLink: DEEP_LINK, extra: true }).success).toBe(false)
    expect(terminalSessionProtocolRouteParamsSchema.safeParse({}).success).toBe(false)
  })

  it("declares exactly one Terminal protocol route for session open", () => {
    expect(terminalCapabilityManifest.protocolRoutes).toEqual([
      expect.objectContaining({
        hostname: "terminals",
        action: "open",
        capabilityId: TERMINAL_SESSION_OPEN_CAPABILITY_ID,
      }),
    ])
    expect(terminalCapabilityManifest.deepLinks).toEqual([])
  })
})
