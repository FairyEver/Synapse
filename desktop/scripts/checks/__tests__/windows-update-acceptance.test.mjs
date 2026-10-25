import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { ownedProcessIds, parseWindowsMetadata, verifyFileSha512 } from "../windows-update-acceptance.mjs"

const digest = createHash("sha512").update("installer").digest("base64")
const metadata = (overrides = {}) => JSON.stringify({
  version: "1.0.79",
  path: "Synapse-1.0.79-win-x64.exe",
  sha512: digest,
  files: [{ url: "Synapse-1.0.79-win-x64.exe", sha512: digest, size: 9 }],
  ...overrides,
})

test("selects the expected Windows installer and SHA512 from vendor metadata", () => {
  assert.deepEqual(parseWindowsMetadata(metadata(), "1.0.79"), {
    version: "1.0.79", file: "Synapse-1.0.79-win-x64.exe", sha512: digest,
  })
})

test("accepts the published version-prefixed paths as well as local builder metadata", () => {
  const file = "v1.0.79/Synapse-1.0.79-win-x64.exe"
  assert.equal(parseWindowsMetadata(metadata({ path: file, files: [{ url: file, sha512: digest }] }), "1.0.79").file,
    "Synapse-1.0.79-win-x64.exe")
})

test("refuses a newer latest feed instead of silently testing a different old version", () => {
  assert.throws(() => parseWindowsMetadata(metadata({ version: "1.0.80" }), "1.0.79"), /version/i)
})

test("refuses absolute URLs, traversal, and non-installer paths", () => {
  for (const url of ["https://other.invalid/installer.exe", "../installer.exe", "Synapse-1.0.79-win-x64.exe/other", "installer.cmd"]) {
    assert.throws(() => parseWindowsMetadata(metadata({ files: [{ url, sha512: digest }] }), "1.0.79"), /installer|path/i)
  }
})

test("refuses missing or malformed digests and conflicting root metadata", () => {
  for (const sha512 of [undefined, "", "not-a-digest"]) {
    assert.throws(() => parseWindowsMetadata(metadata({ files: [{ url: "Synapse-1.0.79-win-x64.exe", sha512 }] }), "1.0.79"), /SHA512/i)
  }
  assert.throws(() => parseWindowsMetadata(metadata({ path: "other.exe" }), "1.0.79"), /path/i)
  assert.throws(() => parseWindowsMetadata(metadata({ sha512: createHash("sha512").update("other").digest("base64") }), "1.0.79"), /SHA512/i)
})

test("checks actual file bytes and rejects a corrupted downloaded installer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-windows-integrity-"))
  try {
    const file = path.join(root, "installer.exe")
    await writeFile(file, "installer")
    await verifyFileSha512(file, digest)
    await writeFile(file, "corrupted")
    await assert.rejects(verifyFileSha512(file, digest), /SHA512/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("retains the Windows process observer startup or timeout cause", () => {
  for (const code of ["ENOENT", "ETIMEDOUT"]) {
    const execute = () => ({ status: null, signal: "SIGTERM", error: Object.assign(new Error(`spawnSync powershell.exe ${code}`), { code }), stderr: "observer diagnostic" })
    assert.throws(() => ownedProcessIds("C:\\owned\\Synapse.exe", false, execute), (error) => error.message.includes(code) && error.message.includes("observer diagnostic"))
  }
})

test("refuses observer stderr even when PowerShell reports a successful exit", () => {
  const execute = () => ({ status: 0, stdout: "", stderr: "Get-CimInstance: query failed" })
  assert.throws(() => ownedProcessIds("C:\\owned\\Synapse.exe", false, execute), /query failed/)
})
