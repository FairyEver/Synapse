import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const { hooks } = require("../../.pnpmfile.cjs")

test("pnpm migration preserves the Electron mirror and existing hook environment", () => {
  const config = { extraEnv: { EXISTING_VALUE: "kept" } }
  const updated = hooks.updateConfig(config)
  assert.equal(updated.extraEnv.ELECTRON_MIRROR, process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/")
  assert.equal(updated.extraEnv.EXISTING_VALUE, "kept")
  assert.deepEqual(config, { extraEnv: { EXISTING_VALUE: "kept" } })
})

test("pnpm migration preserves an explicitly configured Electron mirror", () => {
  const previous = process.env.ELECTRON_MIRROR
  process.env.ELECTRON_MIRROR = "https://example.test/electron/"
  try {
    assert.equal(hooks.updateConfig({}).extraEnv.ELECTRON_MIRROR, "https://example.test/electron/")
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_MIRROR
    else process.env.ELECTRON_MIRROR = previous
  }
})
