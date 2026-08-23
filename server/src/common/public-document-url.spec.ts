import { describe, expect, it } from "vitest"
import { buildPublicDocumentUrl, resolvePublicDocumentUrl } from "./public-document-url"

describe("public document URL", () => {
  it("prefers and normalizes the configured document root", () => {
    expect(resolvePublicDocumentUrl({
      configuredDocumentPublicUrl: "https://docs.example.com/document/",
      configuredPublicAppUrl: "https://app.example.com",
    })).toBe("https://docs.example.com/document")
  })

  it("derives the production document root from the public app root", () => {
    expect(resolvePublicDocumentUrl({
      configuredPublicAppUrl: "https://app.example.com/",
    })).toBe("https://app.example.com/document")
  })

  it("builds document page URLs from the resolved root", () => {
    expect(buildPublicDocumentUrl(
      "http://localhost:19773/document",
      "/open-api/api/share-link-download",
    )).toBe("http://localhost:19773/document/open-api/api/share-link-download")
  })

  it("rejects missing public roots", () => {
    expect(() => resolvePublicDocumentUrl({})).toThrow("DOCUMENT_PUBLIC_URL 或 APP_PUBLIC_URL 未配置")
  })
})
