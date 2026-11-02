import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 12)

/** macOS 不保存协议启动参数，必须让开发 .app 在没有 argv 时也能加载当前仓库。 */
export async function prepareDevElectron({
  desktopRoot,
  devServerUrl,
  platform = process.platform,
  electronExecutable,
}) {
  if (platform !== "darwin") return { command: "electron .", appRoot: null }

  const sourceExecutable = electronExecutable ?? require("electron")
  await access(sourceExecutable)
  const sourceApp = path.resolve(sourceExecutable, "../../..")
  const cacheRoot = path.join(desktopRoot, "node_modules/.cache/synapse-dev", hash(sourceApp))
  const appRoot = path.join(cacheRoot, "Synapse Dev.app")
  const marker = path.join(cacheRoot, "runtime-ready")
  let ready = false
  try {
    await access(marker)
    ready = true
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (!ready) {
    await mkdir(cacheRoot, { recursive: true })
    await cp(sourceApp, appRoot, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    })
    await writeFile(marker, sourceApp)
  }

  const plistPath = path.join(appRoot, "Contents/Info.plist")
  const plist = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath], {
    encoding: "utf8", timeout: 10_000,
  }))
  plist.CFBundleIdentifier = `com.fairyever.synapse.dev.${hash(desktopRoot)}`
  plist.CFBundleName = "Synapse Dev"
  plist.CFBundleDisplayName = "Synapse Dev"
  plist.CFBundleURLTypes = [{
    CFBundleURLName: "Synapse Development",
    CFBundleURLSchemes: ["synapse"],
  }]
  execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", plistPath, "-"], {
    input: JSON.stringify(plist), timeout: 10_000,
  })

  const pkg = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"))
  const appDir = path.join(appRoot, "Contents/Resources/app")
  await mkdir(appDir, { recursive: true })
  await writeFile(path.join(appDir, "package.json"), JSON.stringify({
    name: pkg.name, productName: pkg.productName, version: pkg.version, main: "bootstrap.cjs",
  }))
  // Launch Services 冷启动不继承 pnpm 的环境或 cwd；入口在导入业务代码前恢复它们。
  await writeFile(path.join(appDir, "bootstrap.cjs"), [
    `const { app } = require("electron")`,
    `app.setAppPath(${JSON.stringify(desktopRoot)})`,
    `process.chdir(${JSON.stringify(desktopRoot)})`,
    `process.env.VITE_DEV_SERVER_URL = ${JSON.stringify(devServerUrl)}`,
    `require(${JSON.stringify(path.join(desktopRoot, pkg.main))})`,
    "",
  ].join("\n"))

  // 作为 nodemon 的 shell 命令使用，路径中的空格、引号和 shell 元字符必须保持原样。
  const executable = path.join(appRoot, "Contents/MacOS/Electron")
  return { command: `'${executable.replaceAll("'", "'\"'\"'")}'`, appRoot }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  const launch = await prepareDevElectron({
    desktopRoot,
    devServerUrl: process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${process.env.SYNAPSE_DEV_PORT ?? "19731"}`,
  })
  if (launch.appRoot) registerDevElectron(launch.appRoot)
  process.stdout.write("开发应用协议入口已准备，请重新运行 pnpm dev 后重试登录。\n")
}

export function registerDevElectron(appRoot) {
  execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", appRoot], {
    timeout: 10_000,
  })
}
