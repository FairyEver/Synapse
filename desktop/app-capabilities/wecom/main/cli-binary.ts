import { createRequire } from "node:module"
import path from "node:path"

const WECOM_CLI_PLATFORM_PACKAGES = {
  "darwin-arm64": "@wecom/cli-darwin-arm64",
  "darwin-x64": "@wecom/cli-darwin-x64",
  "linux-arm64": "@wecom/cli-linux-arm64",
  "linux-x64": "@wecom/cli-linux-x64",
  "win32-x64": "@wecom/cli-win32-x64",
} as const

type WecomCliPlatformKey = keyof typeof WECOM_CLI_PLATFORM_PACKAGES

export type ResolveWecomCliBinaryOptions = {
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly isPackaged?: boolean
}

export function resolveWecomCliBinaryPath(options: ResolveWecomCliBinaryOptions = {}): string {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const platformKey = `${platform}-${arch}` as WecomCliPlatformKey
  const packageName = WECOM_CLI_PLATFORM_PACKAGES[platformKey]
  if (!packageName) throw new Error(`企业微信不支持当前平台：${platformKey}`)

  const requireFromDesktop = createRequire(__filename)
  const cliPackageJson = requireFromDesktop.resolve("@wecom/cli/package.json")
  const requireFromCli = createRequire(cliPackageJson)
  const platformPackageJson = requireFromCli.resolve(`${packageName}/package.json`)
  const packageDirectory = path.dirname(platformPackageJson)
  const unpackedDirectory = options.isPackaged
    ? packageDirectory.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : packageDirectory

  return path.join(unpackedDirectory, "bin", platform === "win32" ? "wecom-cli.exe" : "wecom-cli")
}
