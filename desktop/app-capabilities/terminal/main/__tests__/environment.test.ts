import { describe, expect, it } from "vitest"

import {
  resolveTerminalLaunchConfiguration,
  resolveTerminalEnvironment,
  resolveTerminalShellArgs,
  TerminalLaunchValidationError,
} from "../environment"

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
      LANG: "en_US.UTF-8",
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

  it("merges global, group, command, and one-time layers in order", () => {
    const result = resolveTerminalLaunchConfiguration({
      platform: "darwin",
      global: { shell: "/bin/bash", defaultCwd: "/global", environment: { SHARED: "global", GLOBAL_ONLY: "yes" } },
      group: { defaultCwd: "/group", environment: { SHARED: "group", GROUP_ONLY: "yes" } },
      command: { shell: "/bin/zsh", environment: { SHARED: "command", GROUP_ONLY: null, EMPTY: "" } },
      override: { defaultCwd: "/override", environment: { SHARED: "override" } },
    })

    expect(result).toEqual({
      shell: "/bin/zsh",
      cwd: "/override",
      shellKind: "command",
      cwdKind: "override",
      environment: {
        SHARED: "override",
        GLOBAL_ONLY: "yes",
        GROUP_ONLY: null,
        EMPTY: "",
      },
      environmentEntries: [
        { key: "EMPTY", action: "set", source: "command" },
        { key: "GLOBAL_ONLY", action: "set", source: "global" },
        { key: "GROUP_ONLY", action: "unset", source: "command" },
        { key: "SHARED", action: "set", source: "override" },
      ],
    })
  })

  it("normalizes environment names case-insensitively only on Windows", () => {
    expect(resolveTerminalLaunchConfiguration({
      platform: "win32",
      global: { environment: { Path: "global" } },
      group: { environment: { PATH: "group" } },
    }).environment).toEqual({ PATH: "group" })
    expect(resolveTerminalLaunchConfiguration({
      platform: "darwin",
      global: { environment: { Path: "global" } },
      group: { environment: { PATH: "group" } },
    }).environment).toEqual({ Path: "global", PATH: "group" })
  })

  it("keeps empty strings and removes unset values from the spawned environment", () => {
    const result = resolveTerminalEnvironment({
      platform: "darwin",
      baseEnv: { HOME: "/Users/test", SHELL: "/bin/zsh", PATH: "/usr/bin", LANG: "en_US.UTF-8" },
      cwd: "/Users/test",
      validateFilesystem: false,
      overrides: { LANG: null, EMPTY: "" },
      appVersion: "1.2.3",
    })
    expect(result.env).not.toHaveProperty("LANG")
    expect(result.env.EMPTY).toBe("")
    expect(result.env).toMatchObject({ TERM_PROGRAM: "Synapse", TERM_PROGRAM_VERSION: "1.2.3" })
  })

  it("rejects protected variables and bounded environment limits before launch", () => {
    expect(() => resolveTerminalLaunchConfiguration({
      global: { environment: { TERM_PROGRAM: "Other" } },
    })).toThrow(TerminalLaunchValidationError)
    expect(() => resolveTerminalLaunchConfiguration({
      global: { environment: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`KEY_${index}`, "value"])) },
    })).toThrow("Too many")
    expect(() => resolveTerminalLaunchConfiguration({
      global: { environment: { TOO_LARGE: "x".repeat(32 * 1024 + 1) } },
    })).toThrow("too large")
  })

  it("provides a UTF-8 locale for macOS GUI environments without locale variables", () => {
    const result = resolveTerminalEnvironment({
      platform: "darwin",
      baseEnv: {
        HOME: "/Users/test",
        USER: "test",
        SHELL: "/bin/bash",
        PATH: "/usr/bin:/bin",
      },
      cwd: "/Users/test",
      validateFilesystem: false,
    })

    expect(result.env.LANG).toBe("en_US.UTF-8")
  })

  it("preserves an explicit macOS character locale", () => {
    const result = resolveTerminalEnvironment({
      platform: "darwin",
      baseEnv: {
        HOME: "/Users/test",
        SHELL: "/bin/bash",
        PATH: "/usr/bin:/bin",
        LC_CTYPE: "zh_CN.UTF-8",
      },
      cwd: "/Users/test",
      validateFilesystem: false,
    })

    expect(result.env.LC_CTYPE).toBe("zh_CN.UTF-8")
    expect(result.env).not.toHaveProperty("LANG")
  })

  it.each([
    ["/bin/bash", "darwin", ["-l"]],
    ["/bin/zsh", "darwin", ["-l"]],
    ["/opt/homebrew/bin/fish", "darwin", []],
    ["/bin/bash", "linux", []],
  ] as const)("resolves launch arguments for %s on %s", (shell, platform, expected) => {
    expect(resolveTerminalShellArgs(shell, platform)).toEqual(expected)
  })
})
