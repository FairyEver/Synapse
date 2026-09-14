import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { resolveBundledClaudeExecutable } from "../claude-runtime-binary"

const RESOURCES = "/Applications/Synapse.app/Contents/Resources"
const SDK_MODULE = "/repo/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.245/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs"
const PLATFORM_BINARY = "/repo/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.245/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"

describe("resolveBundledClaudeExecutable", () => {
  it("prefers the unpacked packaged runtime without module resolution", () => {
    const binary = path.join(RESOURCES, "app.asar.unpacked", "node_modules",
      "@anthropic-ai/claude-agent-sdk-darwin-arm64", "claude")
    const resolveModule = vi.fn(() => {
      throw new Error("module resolution must not run for a packaged runtime")
    })

    expect(resolveBundledClaudeExecutable({
      resourcesPath: RESOURCES,
      isPackaged: true,
      platform: "darwin",
      arch: "arm64",
      fileExists: (candidate) => candidate === binary,
      resolveModule,
    })).toBe(binary)
    expect(resolveModule).not.toHaveBeenCalled()
  })

  it("resolves the platform package from the SDK location during development", () => {
    const resolveModule = vi.fn((specifier: string, from?: string) => {
      if (specifier === "@anthropic-ai/claude-agent-sdk") return SDK_MODULE
      if (specifier === "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude") {
        expect(from).toBe(SDK_MODULE)
        return PLATFORM_BINARY
      }
      throw new Error(`unexpected specifier: ${specifier}`)
    })

    expect(resolveBundledClaudeExecutable({
      isPackaged: false,
      platform: "darwin",
      arch: "arm64",
      resolveModule,
    })).toBe(PLATFORM_BINARY)
  })

  it("returns undefined when neither the packaged nor the SDK runtime resolves", () => {
    expect(resolveBundledClaudeExecutable({
      isPackaged: false,
      platform: "darwin",
      arch: "arm64",
      resolveModule: () => {
        throw new Error("missing")
      },
    })).toBeUndefined()
  })

  it("never falls back to an asar module path when a packaged runtime is missing", () => {
    const resolveModule = vi.fn(() => PLATFORM_BINARY)

    expect(resolveBundledClaudeExecutable({
      resourcesPath: RESOURCES,
      isPackaged: true,
      platform: "darwin",
      arch: "arm64",
      fileExists: () => false,
      resolveModule,
    })).toBeUndefined()
    expect(resolveModule).not.toHaveBeenCalled()
  })

  it.each([
    { platform: "win32", arch: "x64", packageName: "@anthropic-ai/claude-agent-sdk-win32-x64", binaryName: "claude.exe" },
    { platform: "win32", arch: "arm64", packageName: "@anthropic-ai/claude-agent-sdk-win32-arm64", binaryName: "claude.exe" },
    { platform: "linux", arch: "x64", packageName: "@anthropic-ai/claude-agent-sdk-linux-x64", binaryName: "claude" },
    { platform: "linux", arch: "arm64", packageName: "@anthropic-ai/claude-agent-sdk-linux-arm64-musl", binaryName: "claude" },
  ])("resolves $packageName/$binaryName on $platform-$arch during development", ({ platform, arch, packageName, binaryName }) => {
    const binary = `/${platform}-${arch}/${binaryName}`
    const resolveModule = vi.fn((specifier: string) => {
      if (specifier === "@anthropic-ai/claude-agent-sdk") return SDK_MODULE
      if (specifier === `${packageName}/${binaryName}`) return binary
      throw new Error(`unexpected specifier: ${specifier}`)
    })

    expect(resolveBundledClaudeExecutable({
      isPackaged: false,
      platform,
      arch,
      resolveModule,
    })).toBe(binary)
  })

  it("uses the .exe unpacked runtime name on Windows", () => {
    const binary = path.join(RESOURCES, "app.asar.unpacked", "node_modules",
      "@anthropic-ai/claude-agent-sdk-win32-x64", "claude.exe")
    expect(resolveBundledClaudeExecutable({
      resourcesPath: RESOURCES,
      isPackaged: true,
      platform: "win32",
      arch: "x64",
      fileExists: (candidate) => candidate === binary,
    })).toBe(binary)
  })
})
