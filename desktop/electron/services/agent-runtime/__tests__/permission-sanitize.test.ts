import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  sanitizePermissionRawInput,
  sanitizePermissionText,
} from "../permission-sanitize"

describe("permission sanitizer", () => {
  it("keeps pending permission sanitization centralized in permission-sanitize", () => {
    const source = readFileSync(
      new URL("../agent-runtime-service.ts", import.meta.url),
      "utf8",
    )

    expect(source).not.toContain("function sanitizePendingPermission")
    expect(source).not.toContain("function isSensitivePendingPermissionKey")
  })

  it("redacts nested sensitive permission input with the shared redaction rules", () => {
    expect(sanitizePermissionRawInput({
      command: "curl -H 'Authorization: Bearer sk-tool' /Users/liyang/private/file.ts",
      env: {
        API_KEY: "sk-env",
        regularPath: "/Users/liyang/private/file.ts",
      },
    })).toEqual({
      command: "curl -H 'Authorization: Bearer [redacted]' /Users/liyang/private/file.ts",
      env: {
        API_KEY: "[redacted]",
        regularPath: "/Users/liyang/private/file.ts",
      },
    })

    expect(sanitizePermissionText("api_key=Bearer sk-abc123")).toBe(
      "api_key=Bearer [redacted]",
    )
  })
})
