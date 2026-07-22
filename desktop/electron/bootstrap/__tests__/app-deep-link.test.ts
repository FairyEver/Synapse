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
