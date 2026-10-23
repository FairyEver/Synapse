import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { executableCodeHash, validateRuntimeReport } from "../verify-electron-runtime.mjs"

const baseline = JSON.parse(readFileSync(new URL("../electron-security-baseline.json", import.meta.url)))
const report = { electron: "44.9.3", node: "24.22.0", chrome: "152.0.7977.167", platform: "darwin", arch: "arm64", smoke: "passed" }

test("rejects old Electron even if the build machine Node is patched", () => {
  assert.throws(() => validateRuntimeReport({ ...report, electron: "41.2.1", node: "24.22.1" }, "irrelevant"), /runtime version/)
})
test("rejects a different executable despite matching version strings", () => {
  assert.throws(() => validateRuntimeReport(report, "0".repeat(64)), /official Electron code/)
})
test("rejects failed smoke tests and unsupported architectures", () => {
  const hash = baseline.artifacts["darwin-arm64"].codeSha256
  assert.throws(() => validateRuntimeReport({ ...report, smoke: "failed" }, hash), /smoke/)
  assert.throws(() => validateRuntimeReport({ ...report, arch: "ia32" }, hash), /Unsupported/)
})
test("accepts the reviewed Electron code despite its Node 24.22.0 version", () => {
  assert.doesNotThrow(() => validateRuntimeReport(report, baseline.artifacts["darwin-arm64"].codeSha256))
})
test("hashes Windows executable code independently of mutable signing/resources", () => {
  const binary = Buffer.alloc(400)
  binary.write("MZ"); binary.writeUInt32LE(64, 60); binary.write("PE\0\0", 64)
  binary.writeUInt16LE(1, 70); binary.writeUInt16LE(0, 84)
  binary.write(".text", 88); binary.writeUInt32LE(16, 104); binary.writeUInt32LE(256, 108)
  const hash = executableCodeHash(binary, "win32")
  binary[350] = 1
  assert.equal(executableCodeHash(binary, "win32"), hash)
  binary[256] = 1
  assert.notEqual(executableCodeHash(binary, "win32"), hash)
  binary.writeUInt32LE(999, 108)
  assert.throws(() => executableCodeHash(binary, "win32"), /section/)
})
test("rejects malformed binaries instead of accepting an empty fingerprint", () => {
  for (const platform of ["darwin", "win32"]) {
    assert.throws(() => executableCodeHash(Buffer.alloc(128), platform), /executable/)
  }
})
