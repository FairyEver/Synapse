import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const baseline = JSON.parse(readFileSync(new URL("./electron-security-baseline.json", import.meta.url), "utf8"))

// 签名、公证和产品名资源会改变容器；比较不可变的原生代码 section。
export function executableCodeHash(buffer, platform) {
  let section
  if (platform === "darwin" && buffer.length >= 32 && buffer.readUInt32LE(0) === 0xfeedfacf) {
    let commandOffset = 32
    for (let i = 0; i < buffer.readUInt32LE(16); i++) {
      if (commandOffset + 8 > buffer.length) throw new Error("Invalid executable load command")
      const size = buffer.readUInt32LE(commandOffset + 4)
      if (size < 8 || commandOffset + size > buffer.length) throw new Error("Invalid executable load command size")
      if (buffer.readUInt32LE(commandOffset) === 0x19) {
        if (size < 72) throw new Error("Invalid executable segment")
        const count = buffer.readUInt32LE(commandOffset + 64)
        if (72 + count * 80 > size) throw new Error("Invalid executable sections")
        for (let n = 0; n < count; n++) {
          const offset = commandOffset + 72 + n * 80
          if (buffer.subarray(offset, offset + 16).toString().replace(/\0.*$/, "") === "__text"
            && buffer.subarray(offset + 16, offset + 32).toString().replace(/\0.*$/, "") === "__TEXT") {
            section = [buffer.readUInt32LE(offset + 48), Number(buffer.readBigUInt64LE(offset + 40))]
          }
        }
      }
      commandOffset += size
    }
  } else if (platform === "win32" && buffer.length >= 64 && buffer.toString("ascii", 0, 2) === "MZ") {
    const pe = buffer.readUInt32LE(60)
    if (pe + 24 > buffer.length || buffer.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error("Invalid executable PE header")
    const table = pe + 24 + buffer.readUInt16LE(pe + 20)
    const count = buffer.readUInt16LE(pe + 6)
    if (table + count * 40 > buffer.length) throw new Error("Invalid executable section table")
    for (let n = 0; n < count; n++) {
      const offset = table + n * 40
      if (buffer.subarray(offset, offset + 8).toString().replace(/\0.*$/, "") === ".text") {
        section = [buffer.readUInt32LE(offset + 20), buffer.readUInt32LE(offset + 16)]
      }
    }
  } else throw new Error("Unsupported or invalid executable format")
  if (!section || !Number.isSafeInteger(section[1]) || section[1] <= 0 || section[0] + section[1] > buffer.length) {
    throw new Error("Missing or invalid executable code section")
  }
  return createHash("sha256").update(buffer.subarray(section[0], section[0] + section[1])).digest("hex")
}

export function validateRuntimeReport(report, codeHash) {
  for (const name of ["electron", "node", "chrome"]) {
    if (report[name] !== baseline[name]) throw new Error(`Unreviewed runtime version: ${name}=${report[name]}`)
  }
  const artifact = baseline.artifacts[`${report.platform}-${report.arch}`]
  if (!artifact) throw new Error(`Unsupported runtime target: ${report.platform}-${report.arch}`)
  if (artifact.codeSha256 !== codeHash) throw new Error("Candidate does not match reviewed official Electron code")
  if (report.smoke !== "passed") throw new Error("Candidate runtime smoke failed")
}

export function verifyPackagedElectron(resourcesPath) {
  const appRoot = path.dirname(path.dirname(resourcesPath))
  const mac = appRoot.endsWith(".app")
  const executable = mac
    ? path.join(appRoot, "Contents/MacOS", path.basename(appRoot, ".app"))
    : path.join(path.dirname(resourcesPath), "Synapse.exe")
  const codePath = mac
    ? path.join(appRoot, "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework")
    : executable
  if (!existsSync(executable)) throw new Error(`Candidate executable missing: ${executable}`)
  if ((mac ? "darwin" : "win32") !== process.platform) throw new Error("Run the candidate runtime gate on its target OS")
  const codeHash = executableCodeHash(readFileSync(codePath), mac ? "darwin" : "win32")
  // 先核对代码来源，再执行候选；主进程入口及用户数据不会被加载。
  if (!Object.values(baseline.artifacts).some((artifact) => artifact.codeSha256 === codeHash)) {
    throw new Error("Candidate does not match reviewed official Electron code")
  }
  if (mac) {
    const plist = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSMinimumSystemVersion", path.join(appRoot, "Contents/Info.plist")], { encoding: "utf8", timeout: 5000 })
    if (plist.status !== 0 || plist.stdout.trim() !== "13.0.0") throw new Error("Candidate macOS minimum must be 13.0.0")
  }
  const smoke = spawnSync(executable, ["-e", readFileSync(new URL("./electron-runtime-probe.cjs", import.meta.url), "utf8")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "", NODE_PATH: "" }, encoding: "utf8", timeout: 20_000,
  })
  if (smoke.status !== 0) throw new Error(`Candidate runtime smoke failed: ${smoke.error?.message ?? smoke.stderr}`)
  const report = JSON.parse(smoke.stdout)
  validateRuntimeReport(report, codeHash)
  return { ...report, codeSha256: codeHash, source: baseline.artifacts[`${report.platform}-${report.arch}`].url }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error("Usage: verify-electron-runtime.mjs <candidate-resources-directory>")
    process.stdout.write(`${JSON.stringify(verifyPackagedElectron(path.resolve(process.argv[2])), null, 2)}\n`)
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
