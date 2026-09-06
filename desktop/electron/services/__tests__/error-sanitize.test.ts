import { describe, expect, it } from "vitest"
import {
  isAbsoluteLocalPath,
  redactAbsolutePathsInText,
  sanitizeError,
} from "../error-sanitize"

describe("sanitizeError", () => {
  it("preserves clean text unchanged", () => {
    expect(sanitizeError("node execution failed")).toBe("node execution failed")
  })

  it("redacts sk- API keys via key-value pattern", () => {
    const result = sanitizeError("token=sk-test123456789")
    expect(result).not.toContain("sk-test123456789")
    expect(result).toContain("[redacted]")
  })

  it("redacts standalone sk- keys without key-value wrapper", () => {
    const result = sanitizeError("error: sk-test123456789 is invalid")
    expect(result).not.toContain("sk-test123456789")
    expect(result).toContain("[key]")
  })

  it("redacts Bearer tokens even when preceded by a matched key", () => {
    const result = sanitizeError("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9")
    expect(result).toMatch(/\[redacted\]/)
  })

  it("redacts named secrets after separator", () => {
    const result = sanitizeError("connection failed: token = ghp_test_secret")
    expect(result).not.toContain("ghp_test_secret")
    expect(result).toMatch(/token\s*=\s*\[redacted\]/)
  })

  it("redacts quoted secret values", () => {
    const result = sanitizeError('api_key="sk-test-secret-value"')
    expect(result).not.toContain("sk-test-secret-value")
    expect(result).toContain("api_key=[redacted]")
  })

  it("redacts prefixed environment variable secret names", () => {
    const result = sanitizeError(
      "ANTHROPIC_API_KEY=sk-ant-test123456 OPENAI_API_KEY=sk-openai-test123456 GITHUB_TOKEN=ghp_named_secret MY_SECRET_TOKEN=plain-secret",
    )

    expect(result).not.toContain("sk-ant-test123456")
    expect(result).not.toContain("sk-openai-test123456")
    expect(result).not.toContain("ghp_named_secret")
    expect(result).not.toContain("plain-secret")
    expect(result).toContain("ANTHROPIC_API_KEY=[redacted]")
    expect(result).toContain("GITHUB_TOKEN=[redacted]")
    expect(result).toContain("MY_SECRET_TOKEN=[redacted]")
  })

  it("redacts standalone platform tokens", () => {
    const result = sanitizeError("tokens: github_pat_1234567890abcdef ghp_abcdef123456 glpat-abcdef123456")

    expect(result).not.toContain("github_pat_1234567890abcdef")
    expect(result).not.toContain("ghp_abcdef123456")
    expect(result).not.toContain("glpat-abcdef123456")
    expect(result).toContain("[key]")
  })

  it("redacts POSIX paths preceded by whitespace", () => {
    const result = sanitizeError("file not found at /Users/example/repo/config.json")
    expect(result).not.toContain("/Users/example/repo/config.json")
    expect(result).toContain("[path]")
  })

  it("redacts Windows paths", () => {
    const result = sanitizeError("error in C:\\Users\\example\\config.json")
    expect(result).not.toContain("C:\\Users\\example\\config.json")
    expect(result).toContain("[path]")
  })

  it("redacts URL userinfo from embedded fetch errors", () => {
    const result = sanitizeError(
      "Request cannot be constructed from a URL that includes credentials: https://token123:secret@api.example.com/data",
    )
    expect(result).not.toContain("token123")
    expect(result).not.toContain("secret")
    expect(result).toContain("https://[redacted]@api.example.com/data")
  })

  it("handles mixed sensitive fields in one string", () => {
    const input = 'auth: token=sk-test-key at /Users/test/repo'
    const result = sanitizeError(input)
    expect(result).not.toContain("sk-test-key")
    expect(result).not.toContain("/Users/test/repo")
    expect(result).toContain("[redacted]")
    expect(result).toContain("[path]")
  })

  it("redacts a quoted path even when its last segment looks like a secret field", () => {
    const input = "ENOENT: opendir '/var/tmp/source-token=sk-secret'"
    const result = sanitizeError(input)

    expect(result).toBe("ENOENT: opendir '[path]'")
    expect(result).not.toContain("/var/tmp")
    expect(result).not.toContain("sk-secret")
  })

  it("handles empty string", () => {
    expect(sanitizeError("")).toBe("")
  })

  it("handles whitespace-only string", () => {
    expect(sanitizeError("   ")).toBe("")
  })

  it("handles credential keys", () => {
    const result = sanitizeError("credential=my-password-123")
    expect(result).not.toContain("my-password-123")
    expect(result).toContain("[redacted]")
  })

  it("redacts standalone Bearer token without key prefix", () => {
    const result = sanitizeError("invalid: Bearer xyz.invalid.token-more")
    expect(result).not.toContain("xyz.invalid.token-more")
    expect(result).toContain("Bearer [redacted]")
  })
})

describe("redactAbsolutePathsInText", () => {
  it("redacts an escaped quoted path with spaces inside serialized tool text", () => {
    const input = String.raw`Bash\n{"command":"ls -la \"/Users/liyang/Library/Application Support/Synapse/workspace/\""}`

    expect(redactAbsolutePathsInText(input)).toBe(
      String.raw`Bash\n{"command":"ls -la \"[path]\""}`,
    )
  })

  it("redacts top-level, multi-level, file URL, quoted-space, and Windows paths", () => {
    const input = [
      "/tmp /etc /foo /var/lib/app/config.json",
      "file:///Users/example/Project%20Space/file.ts",
      "\"/Users/example/Project Space/file.ts\"",
      "`C:\\Users\\example\\Project Space\\file.ts`",
    ].join("\n")
    const result = redactAbsolutePathsInText(input)

    expect(result).not.toContain("/tmp")
    expect(result).not.toContain("file:///")
    expect(result).not.toContain("Project Space/file.ts")
    expect(result).not.toContain("C:\\Users")
    expect(result.match(/\[path\]/g)).toHaveLength(7)
  })

  it("preserves URLs, relative paths, protocol-relative URLs, and ordinary slash text", () => {
    const input = "https://example.test/api/v1 docs/setup.md and/or a/b //cdn.example.test/app.js"
    expect(redactAbsolutePathsInText(input)).toBe(input)
  })

  it("recognizes only complete local absolute path values", () => {
    expect(isAbsoluteLocalPath("/tmp")).toBe(true)
    expect(isAbsoluteLocalPath("C:\\Users\\example\\file.ts")).toBe(true)
    expect(isAbsoluteLocalPath("file:///Users/example/file.ts")).toBe(true)
    expect(isAbsoluteLocalPath("https://example.test/api/v1")).toBe(false)
    expect(isAbsoluteLocalPath("docs/setup.md")).toBe(false)
    expect(isAbsoluteLocalPath("and/or")).toBe(false)
  })
})
