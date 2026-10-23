import assert from "node:assert/strict"
import test from "node:test"

import { assertSecureNodeRuntime } from "../deploy/check-node-runtime.mjs"

test("rejects production Node versions preceding the October 2026 security fixes", () => {
  for (const version of ["22.23.3", "22.22.3", "24.14.1", "24.22.0"]) {
    assert.throws(() => assertSecureNodeRuntime(version), /Node\.js .* requires/u, version)
  }
})

test("accepts the fixed versions and later patches in supported release lines", () => {
  for (const version of ["22.23.4", "22.23.5", "22.24.0", "24.22.1", "24.22.2", "24.23.0"]) {
    assert.doesNotThrow(() => assertSecureNodeRuntime(version), version)
  }
})

test("rejects unsupported release lines even when their patch number is higher", () => {
  for (const version of ["20.99.99", "23.99.99", "25.99.99", "26.12.1"]) {
    assert.throws(() => assertSecureNodeRuntime(version), /Unsupported Node\.js/u, version)
  }
})

test("rejects malformed and prerelease versions", () => {
  for (const version of ["", "22.23", "22.23.4-rc.1", "24.22.1garbage", "v24.22.1"]) {
    assert.throws(() => assertSecureNodeRuntime(version), /Invalid Node\.js/u, version)
  }
})
