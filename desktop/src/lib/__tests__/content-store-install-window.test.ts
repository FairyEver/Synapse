import { describe, expect, it } from "vitest"

import {
  buildContentStoreInstallWindowSearchParams,
  parseContentStoreInstallProtocolUrl,
  parseContentStoreInstallWindowRequest,
} from "@/lib/content-store-install-window"

describe("content store install protocol parsing", () => {
  it("accepts a content-install URL with one non-empty session", () => {
    expect(parseContentStoreInstallProtocolUrl("synapse://content-install?session=session-1")).toEqual({
      session: "session-1",
    })
  })

  it.each([
    "synapse://content-install",
    "synapse://content-install?session=",
    "synapse://content-install?session=%20",
    "synapse://content-install/?session=session-1",
    "synapse://content-install/other?session=session-1",
    "synapse://content-install?session=session-1&extra=value",
    "synapse://content-install?session=one&session=two",
    "synapse://auth/desktop/callback?session=session-1",
    "https://content-install?session=session-1",
    "not a url",
  ])("rejects invalid content-install URL %s", (url) => {
    expect(parseContentStoreInstallProtocolUrl(url)).toBeNull()
  })
})

describe("content store install window request parsing", () => {
  it("round-trips the install session query", () => {
    const params = buildContentStoreInstallWindowSearchParams({ session: "session-1" })

    expect(params.toString()).toBe("synapseWindow=content-store-install&session=session-1")
    expect(parseContentStoreInstallWindowRequest(`?${params.toString()}`)).toEqual({
      session: "session-1",
    })
  })

  it("rejects a missing or empty install session", () => {
    expect(parseContentStoreInstallWindowRequest("?synapseWindow=content-store-install")).toBeNull()
    expect(parseContentStoreInstallWindowRequest("?synapseWindow=content-store-install&session=%20")).toBeNull()
  })
})
