#!/usr/bin/env node
import { build, Platform, Arch } from "electron-builder"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import finalizeMacUpdateMetadata from "./prepare-cdn-release-artifacts.mjs"

const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

export async function packageMacCompiled({ outDir = path.join(packageRoot, "release"), buildApp = build } = {}) {
  // build() resolve 时 publish manager 已完成更新元数据写入。禁止自动上传。
  const artifactPaths = await buildApp({ projectDir: packageRoot,
    targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.arm64), publish: "never",
    config: { directories: { output: outDir } },
  })
  await finalizeMacUpdateMetadata({ artifactPaths, outDir })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--out-dir")
  if (index >= 0 && !process.argv[index + 1]) throw new Error("--out-dir requires a directory")
  packageMacCompiled(index >= 0 ? { outDir: path.resolve(process.argv[index + 1]) } : {}).catch((error) => {
    process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  })
}
