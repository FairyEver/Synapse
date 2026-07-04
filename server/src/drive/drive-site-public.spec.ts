import { describe, expect, it } from "vitest"
import { driveSiteContentType } from "./drive-site-public"

describe("drive site public helpers", () => {
  it("prefers known web asset extensions over generic stored content types", () => {
    expect(driveSiteContentType("index.html", "application/octet-stream")).toBe("text/html; charset=utf-8")
    expect(driveSiteContentType("assets/app.js", "text/plain")).toBe("text/javascript; charset=utf-8")
    expect(driveSiteContentType("assets/styles.css", "application/octet-stream")).toBe("text/css; charset=utf-8")
  })

  it("keeps stored content types for unknown extensions", () => {
    expect(driveSiteContentType("downloads/archive.custom", "application/x-custom")).toBe("application/x-custom")
  })
})
