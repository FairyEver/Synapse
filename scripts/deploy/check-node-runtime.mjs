import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

// 服务端支持的 Node 发布线及 2026-10-21 安全更新的最低补丁版本。
const securityFloors = new Map([
  [22, [23, 4]],
  [24, [22, 1]],
])

export function assertSecureNodeRuntime(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Invalid Node.js version: ${version}`)
  }
  const [major, minor, patch] = version.split(".").map(Number)
  const floor = securityFloors.get(major)
  if (!floor) {
    throw new Error(`Unsupported Node.js release line: ${version}; use Node.js 22 or 24`)
  }
  const [minimumMinor, minimumPatch] = floor
  if (minor < minimumMinor || (minor === minimumMinor && patch < minimumPatch)) {
    throw new Error(`Node.js ${version} requires >=${major}.${minimumMinor}.${minimumPatch} in the ${major}.x release line`)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    assertSecureNodeRuntime(process.versions.node)
    process.stdout.write(`Node.js ${process.versions.node}: security floor verified\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
