import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  appendPathEntries,
  buildHostEnvironment,
  collectShellEnvironmentSnapshot,
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

  it("skips directories that collide with an executable name", () => {
    const rootPath = mkdtempSync(path.join(os.tmpdir(), "synapse-shell-environment-"))
    const firstBinPath = path.join(rootPath, "first-bin")
    const secondBinPath = path.join(rootPath, "second-bin")
    const gitPath = path.join(secondBinPath, "git")

    mkdirSync(path.join(firstBinPath, "git"), { recursive: true })
    mkdirSync(secondBinPath, { recursive: true })
    writeFileSync(gitPath, "")

    try {
      expect(resolveExecutableInPath("git", `${firstBinPath}:${secondBinPath}`, {
        platform: "linux",
      })).toBe(gitPath)
    } finally {
      rmSync(rootPath, { force: true, recursive: true })
    }
  })

  it("resolves Windows executables using PATHEXT order", () => {
    const existing = new Set(["C:\\Tools\\node.PS1"])
    const result = resolveExecutableInPath("node", "C:\\Tools", {
      platform: "win32",
      pathext: ".PS1;.EXE",
      fileExists: (candidate) => existing.has(candidate),
    })

    expect(result).toBe("C:\\Tools\\node.PS1")
  })

  it("falls back to default Windows executable extensions when PATHEXT is missing", () => {
    const existing = new Set(["C:\\Tools\\git.cmd"])
    const result = resolveExecutableInPath("git", "C:\\Tools", {
      platform: "win32",
      fileExists: (candidate) => existing.has(candidate),
    })

    expect(result).toBe("C:\\Tools\\git.cmd")
  })

  it("reports git visibility across process, shell, and effective PATH", () => {
    const existing = new Set([
      "/usr/bin/git",
      "/opt/homebrew/bin/git",
      "/synapse/runtime-bin/node",
    ])

    const snapshot = collectShellEnvironmentSnapshot({
      baseEnv: {
        PATH: "/usr/bin:/bin",
      },
      shellPath: "/opt/homebrew/bin:/usr/bin",
      nodeRuntimeBinPath: "/synapse/runtime-bin",
      platform: "darwin",
      fileExists: (candidate) => existing.has(candidate),
    })

    expect(snapshot.processGitPath).toBe("/usr/bin/git")
    expect(snapshot.shellGitPath).toBe("/opt/homebrew/bin/git")
    expect(snapshot.effectiveGitPath).toBe("/usr/bin/git")
  })

  it("uses PATHEXT from the base environment when collecting Windows executable visibility", () => {
    const existing = new Set(["C:\\Tools\\node.PY"])

    const snapshot = collectShellEnvironmentSnapshot({
      baseEnv: {
        Path: "C:\\Tools",
        PATHEXT: ".PY;.EXE",
      },
      shellPath: null,
      platform: "win32",
      fileExists: (candidate) => existing.has(candidate),
    })

    expect(snapshot.processNodePath).toBe("C:\\Tools\\node.PY")
    expect(snapshot.effectiveNodePath).toBe("C:\\Tools\\node.PY")
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
