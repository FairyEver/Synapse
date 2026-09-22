import { describe, expect, it } from "vitest"
import { redactSensitiveText, redactSensitiveValue } from "../agent-redaction"

const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"fake-canary"}').toString('base64url')}.c3ludGhldGljLXNpZ25hdHVyZQ`
describe("content-based credential redaction", () => {
  it.each([`SY=${jwt}`, `PT='${jwt}'`, `export X="${jwt}"`, JSON.stringify({ command: `SY=${jwt}\nPT=${jwt}` }), `value ${jwt}`, `Bearer ${jwt}`])("redacts JWTs regardless of variable name: %s", (text) => {
    expect(redactSensitiveText(text)).not.toContain(jwt)
    expect(redactSensitiveText(text)).toContain("[redacted]")
  })
  it("redacts nested input/result displays without mutating execution values", () => {
    const input = { toolInput: { command: `SY=${jwt}` }, result: [jwt], file_path: "/Users/test/project/file.ts" }
    const output = redactSensitiveValue(input)
    expect(JSON.stringify(output)).not.toContain(jwt)
    expect(output).toMatchObject({ file_path: input.file_path })
    expect(input.toolInput.command).toContain(jwt)
  })
  it("preserves ordinary dotted names, paths, versions and non-JWT data", () => {
    const text = '/Users/test/project/a.b.ts version 1.2.3 package.name.ext e30.e30.fake'
    expect(redactSensitiveText(text)).toBe(text)
  })
  it("keeps existing header/key redaction", () => {
    const text = 'token=token-canary\nAuthorization: Bearer bearer-canary\nCookie: session=cookie-canary\n--env API_KEY=api-canary'
    expect(redactSensitiveText(text)).not.toMatch(/token-canary|bearer-canary|cookie-canary|api-canary/)
  })
})
