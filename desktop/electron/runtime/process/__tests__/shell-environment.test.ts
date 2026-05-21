import { describe, expect, it } from "vitest"

import {
  appendPathEntries,
  buildHostEnvironment,
  createNodeRuntimeShimScript,
  resolveLoginShellPath,
  resolveExecutableInPath,
} from "../shell-environment"

describe("shell environment helpers", () => {
  it("merges login shell PATH and appends Synapse runtime bin after user tools", () => {
    const env = buildHostEnvironment({
      baseEnv: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/ada",
        SECRET_VALUE: "kept-for-host-env",
      },
      shellPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
      appendPathEntries: ["/Users/ada/Library/Application Support/Synapse/runtime-bin"],
      platform: "darwin",
    })

    expect(env.PATH).toBe(
      "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/ada/Library/Application Support/Synapse/runtime-bin",
    )
    expect(env.HOME).toBe("/Users/ada")
    expect(env.SECRET_VALUE).toBe("kept-for-host-env")
  })

  it("keeps existing PATH order while appending fallback entries once", () => {
    expect(appendPathEntries(
      "/opt/homebrew/bin:/usr/bin",
      ["/usr/bin", "/synapse/runtime-bin"],
      ":",
      false,
    )).toBe("/opt/homebrew/bin:/usr/bin:/synapse/runtime-bin")
  })

  it("resolves executables from a provided PATH", () => {
    const existing = new Set(["/opt/homebrew/bin/node"])
    const result = resolveExecutableInPath("node", "/usr/bin:/opt/homebrew/bin", {
      platform: "darwin",
      fileExists: (candidate) => existing.has(candidate),
    })

    expect(result).toBe("/opt/homebrew/bin/node")
  })

  it("builds a POSIX node shim that runs through Electron as Node", () => {
    expect(createNodeRuntimeShimScript({
      platform: "darwin",
      runtimePath: "/Applications/Synapse.app/Contents/MacOS/Synapse",
    })).toContain("ELECTRON_RUN_AS_NODE=1")
  })

  it("extracts login shell PATH from a marked line when shell startup prints extra output", () => {
    const result = resolveLoginShellPath({
      env: {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin:/bin",
        HOME: "/Users/ada",
      },
      platform: "darwin",
      execFileSyncImpl: () => [
        "loading custom zsh profile",
        "__SYNAPSE_PATH_BEGIN__/opt/homebrew/bin:/usr/bin:/bin__SYNAPSE_PATH_END__",
        "done",
      ].join("\n"),
    })

    expect(result).toBe("/opt/homebrew/bin:/usr/bin:/bin")
  })

  it("uses Windows Path case-insensitively when building the host PATH", () => {
    const env = buildHostEnvironment({
      baseEnv: {
        Path: "C:\\Windows\\System32;C:\\Windows",
      },
      shellPath: null,
      appendPathEntries: ["C:\\Synapse\\runtime-bin"],
      platform: "win32",
    })

    expect(env.PATH).toBe("C:\\Windows\\System32;C:\\Windows;C:\\Synapse\\runtime-bin")
  })
})
