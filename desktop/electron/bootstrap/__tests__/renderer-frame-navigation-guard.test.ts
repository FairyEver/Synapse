import { describe, expect, it } from "vitest"

import { shouldBlockRendererSubframeNavigation } from "../renderer-frame-navigation-guard"

describe("renderer subframe navigation guard", () => {
  it("blocks a custom iframe from navigating into the Synapse renderer origin", () => {
    expect(shouldBlockRendererSubframeNavigation({
      url: "http://127.0.0.1:19731/custom-frame",
      mainFrameUrl: "http://127.0.0.1:19731/",
      isMainFrame: false,
    })).toBe(true)
  })

  it("allows unrelated origins and main-frame navigation", () => {
    expect(shouldBlockRendererSubframeNavigation({
      url: "https://app.example.com/next",
      mainFrameUrl: "http://127.0.0.1:19731/",
      isMainFrame: false,
    })).toBe(false)
    expect(shouldBlockRendererSubframeNavigation({
      url: "http://127.0.0.1:19731/",
      mainFrameUrl: "http://127.0.0.1:19731/",
      isMainFrame: true,
    })).toBe(false)
  })
})
