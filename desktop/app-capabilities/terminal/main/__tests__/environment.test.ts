import { describe, expect, it } from "vitest"

import { resolveTerminalEnvironment } from "../environment"

describe("TerminalEnvironmentResolver", () => {
  it("constructs a Unix environment from an allowlist instead of cloning Electron", () => {
    const result = resolveTerminalEnvironment({
      platform: "darwin",
      baseEnv: {
        HOME: "/Users/test",
        USER: "test",
        SHELL: "/bin/zsh",
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        SYNAPSE_INTERNAL_TOKEN: "must-not-leak",
        PROVIDER_SECRET: "must-not-leak",
      },
      effectivePath: "/opt/homebrew/bin:/usr/bin:/bin",
      cwd: "/Users/test/project",
      validateFilesystem: false,
    })
    expect(result.env).toMatchObject({
      HOME: "/Users/test",
      USER: "test",
      SHELL: "/bin/zsh",
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    })
    expect(result.env).not.toHaveProperty("SYNAPSE_INTERNAL_TOKEN")
    expect(result.env).not.toHaveProperty("PROVIDER_SECRET")
  })

  it("preserves required Windows process bootstrap fields without unrelated values", () => {
    const result = resolveTerminalEnvironment({
      platform: "win32",
      baseEnv: {
        SystemRoot: "C:\\Windows",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        USERPROFILE: "C:\\Users\\test",
        Path: "C:\\Windows\\System32",
        MCP_AUTH_TOKEN: "must-not-leak",
      },
      effectivePath: "C:\\Windows\\System32",
      cwd: "C:\\Users\\test",
      validateFilesystem: false,
    })
    expect(result.shell).toBe("C:\\Windows\\System32\\cmd.exe")
    expect(result.env).toMatchObject({
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      PATH: "C:\\Windows\\System32",
    })
    expect(result.env).not.toHaveProperty("MCP_AUTH_TOKEN")
  })

  it("rejects explicit sensitive-internal override names", () => {
    expect(() => resolveTerminalEnvironment({
      platform: "darwin",
      baseEnv: { HOME: "/Users/test", SHELL: "/bin/zsh", PATH: "/usr/bin" },
      cwd: "/Users/test",
      validateFilesystem: false,
      overrides: { SYNAPSE_API_TOKEN: "secret" },
    })).toThrow("Protected")
  })

  it("allows an explicitly configured user secret while still excluding inherited values", () => {
    const result = resolveTerminalEnvironment({
      platform: "darwin",
      baseEnv: { HOME: "/Users/test", SHELL: "/bin/zsh", PATH: "/usr/bin", USER_API_TOKEN: "inherited" },
      cwd: "/Users/test",
      validateFilesystem: false,
      overrides: { USER_API_TOKEN: "explicit" },
    })
    expect(result.env.USER_API_TOKEN).toBe("explicit")
  })
})
