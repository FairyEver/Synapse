import { existsSync } from "node:fs"
import path from "node:path"

export const PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE = "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。"

export type PackagedClaudeRuntimeStatus =
  | {
    readonly status: "not-packaged"
    readonly resourcesPath?: string
    readonly platform: string
    readonly arch: string
  }
  | {
    readonly status: "unsupported-platform"
    readonly resourcesPath: string
    readonly platform: string
    readonly arch: string
    readonly expectedPackages: readonly string[]
    readonly expectedPaths: readonly string[]
    readonly binaryName: string
  }
  | {
    readonly status: "missing"
    readonly resourcesPath: string
    readonly platform: string
    readonly arch: string
    readonly expectedPackages: readonly string[]
    readonly expectedPaths: readonly string[]
    readonly binaryName: string
  }
  | {
    readonly status: "present"
    readonly resourcesPath: string
    readonly platform: string
    readonly arch: string
    readonly expectedPackages: readonly string[]
    readonly expectedPaths: readonly string[]
    readonly packageName: string
    readonly binaryName: string
    readonly executablePath: string
  }

export function inspectPackagedClaudeRuntime(options: {
  readonly resourcesPath?: string
  readonly platform?: string
  readonly arch?: string
  readonly isPackaged?: boolean
  readonly fileExists?: (filePath: string) => boolean
} = {}): PackagedClaudeRuntimeStatus {
  const fileExists = options.fileExists ?? existsSync
  const processWithResources = process as NodeJS.Process & { readonly resourcesPath?: string }
  const resourcesPath = options.resourcesPath ?? processWithResources.resourcesPath
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch

  if (!resourcesPath || options.isPackaged === false) {
    return { status: "not-packaged", resourcesPath, platform, arch }
  }
  if (options.isPackaged !== true && !fileExists(path.join(resourcesPath, "app.asar"))) {
    return { status: "not-packaged", resourcesPath, platform, arch }
  }

  const expectedPackages = nativeClaudePackageNames(platform, arch)
  const binaryName = claudeBinaryName(platform)
  const expectedPaths = expectedPackages.map((packageName) =>
    path.join(resourcesPath, "app.asar.unpacked", "node_modules", packageName, binaryName)
  )

  if (expectedPackages.length === 0) {
    return {
      status: "unsupported-platform",
      resourcesPath,
      platform,
      arch,
      expectedPackages,
      expectedPaths,
      binaryName,
    }
  }

  for (let index = 0; index < expectedPackages.length; index += 1) {
    const executablePath = expectedPaths[index]
    if (executablePath && fileExists(executablePath)) {
      return {
        status: "present",
        resourcesPath,
        platform,
        arch,
        expectedPackages,
        expectedPaths,
        packageName: expectedPackages[index] ?? "",
        binaryName,
        executablePath,
      }
    }
  }

  return {
    status: "missing",
    resourcesPath,
    platform,
    arch,
    expectedPackages,
    expectedPaths,
    binaryName,
  }
}

export function nativeClaudePackageNames(platform: string, arch: string): readonly string[] {
  if (platform === "linux") {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
      `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
    ]
  }
  if (platform === "darwin" || platform === "win32") {
    return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`]
  }
  return []
}

export function createMissingPackagedClaudeRuntimeError(
  status: Extract<PackagedClaudeRuntimeStatus, { status: "missing" }>,
): Error {
  const expected =
    status.expectedPackages.length > 0
      ? `${status.expectedPackages.join(" or ")}/${status.binaryName}`
      : status.binaryName
  return new Error(`${PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE} 缺少 ${expected}。`)
}

export function resourcesPathFromAppPath(appPath: string): string | undefined {
  return path.basename(appPath) === "app.asar" ? path.dirname(appPath) : undefined
}

function claudeBinaryName(platform: string): string {
  return platform === "win32" ? "claude.exe" : "claude"
}
