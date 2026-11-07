import { describe, expect, it } from "vitest"

import {
  CUSTOM_APP_IFRAME_ALLOW,
  customAppIframeSandbox,
} from "../iframe-compatibility"

describe("custom app iframe compatibility", () => {
  it("grants same-origin behavior to cross-origin pages", () => {
    const sandbox = customAppIframeSandbox(
      "https://app.example.com/dashboard",
      "http://127.0.0.1:19731/",
    )

    expect(sandbox).toContain("allow-same-origin")
    expect(sandbox).toContain("allow-scripts")
    expect(sandbox).toContain("allow-modals")
    expect(sandbox).not.toContain("allow-top-navigation")
    expect(sandbox).not.toContain("allow-popups")
    expect(sandbox).not.toContain("allow-downloads")
  })

  it("never grants same-origin to a page from the Synapse renderer origin", () => {
    const sandbox = customAppIframeSandbox(
      "http://127.0.0.1:19731/custom",
      "http://127.0.0.1:19731/",
    )

    expect(sandbox).not.toContain("allow-same-origin")
    expect(sandbox).toContain("allow-scripts")
  })

  it("delegates compatible features while denying sensitive permissions", () => {
    expect(CUSTOM_APP_IFRAME_ALLOW).toContain("autoplay *")
    expect(CUSTOM_APP_IFRAME_ALLOW).toContain("fullscreen *")
    expect(CUSTOM_APP_IFRAME_ALLOW).toContain("clipboard-write *")
    expect(CUSTOM_APP_IFRAME_ALLOW).toContain("camera 'none'")
    expect(CUSTOM_APP_IFRAME_ALLOW).toContain("clipboard-read 'none'")
    expect(CUSTOM_APP_IFRAME_ALLOW).toContain("geolocation 'none'")
  })
})
