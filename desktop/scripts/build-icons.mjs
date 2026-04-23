/**
 * 作用：把 `source/icon.png` 生成为 Electron 打包要用的图标文件。
 * 一般在更换应用图标素材后手动运行 `pnpm icons`。
 * 输出目录是 `build/`，会生成 `icon.ico`、`icon.icns` 等平台资源。
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, "..")
const inputPath = resolve(rootDir, "source/icon.png")
const outputDir = resolve(rootDir, "build")
const outputBasePath = resolve(outputDir, "icon")
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

if (!existsSync(inputPath)) {
  console.error(`[icons] Missing source image: ${inputPath}`)
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })

const result = spawnSync(
  pnpmCommand,
  ["dlx", "png2icons", inputPath, outputBasePath, "-allwe", "-i"],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
)

if (result.error) {
  console.error("[icons] Failed to run png2icons.", result.error)
  process.exit(1)
}

process.exit(result.status ?? 0)
