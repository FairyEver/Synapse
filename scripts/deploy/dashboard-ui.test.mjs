import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { resolveDashboardBuild } from "./dashboard-ui.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const selector = join(root, "scripts/deploy/dashboard-ui.mjs")

test("the default and explicit v1 target the existing dashboard", () => {
  for (const value of [undefined, "", "v1"]) {
    assert.deepEqual(resolveDashboardBuild(value), { ui: "v1", package: "@synapse/dashboard", directory: "dashboard" })
  }
})

test("v2 selects only the HeroUI dashboard package", () => {
  assert.deepEqual(resolveDashboardBuild("v2"), { ui: "v2", package: "@synapse/dashboard-v2", directory: "dashboard-v2" })
})

test("unknown or shell-shaped selectors fail rather than falling back", () => {
  for (const value of ["V2", "v3", " v2", "v2 ", "v2; touch ignored", "v2'", "../dashboard", 2]) {
    assert.throws(() => resolveDashboardBuild(value), /DASHBOARD_UI must be v1 or v2/u)
  }
})

test("the CLI emits only the selected field consumed by the Docker build", () => {
  for (const [args, expected] of [[[], "v1"], [["v2"], "v2"], [["v2", "package"], "@synapse/dashboard-v2"], [["v2", "directory"], "dashboard-v2"]]) {
    const result = spawnSync(process.execPath, [selector, ...args], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expected)
  }
})

test("invalid selection aborts deploy before any network, backup or build action", () => {
  const temporary = mkdtempSync(join(tmpdir(), "synapse-dashboard-selector-")), bin = join(temporary, "bin"), trace = join(temporary, "calls")
  mkdirSync(bin)
  try {
    for (const name of ["ssh", "scp", "rsync", "docker"]) {
      writeFileSync(join(bin, name), '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$TRACE"\nexit 99\n', { mode: 0o755 })
    }
    const result = spawnSync("bash", ["deploy.sh"], { cwd: root, encoding: "utf8", env: { ...process.env, DASHBOARD_UI: "unrecognized", TRACE: trace, PATH: `${bin}:${process.env.PATH}` } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /DASHBOARD_UI must be v1 or v2/u)
    assert.throws(() => readFileSync(trace), { code: "ENOENT" })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test("the local selector reaches the remote compose build without relying on its env file", () => {
  const temporary = mkdtempSync(join(tmpdir(), "synapse-dashboard-remote-")), bin = join(temporary, "bin"), trace = join(temporary, "calls")
  mkdirSync(bin)
  mkdirSync(join(temporary, "server"))
  try {
    writeFileSync(join(bin, "docker"), '#!/bin/sh\nprintf "%s\\t%s\\n" "${DASHBOARD_UI:-unset}" "$*" >> "$TRACE"\n', { mode: 0o755 })
    const script = readFileSync(join(root, "deploy.sh"), "utf8")
    const build = script.match(/build_remote_image\(\) \{[\s\S]*?\n\}/u)?.[0]
    assert.ok(build)
    const result = spawnSync("bash", ["-c", `${build}\nssh() { shift; bash -c "$*"; }\nbuild_remote_image`], {
      cwd: root, encoding: "utf8", env: { ...process.env, DASHBOARD_UI: "v2", SERVER: "test-only", REMOTE_DIR: temporary, NEW_IMAGE_TAG: "test-only", TRACE: trace, PATH: `${bin}:${process.env.PATH}` },
    })
    assert.equal(result.status, 0, result.stderr)
    const lines = readFileSync(trace, "utf8").trim().split("\n")
    assert.equal(lines[0], "v2\tcompose --env-file .env build --pull server pdf-renderer")
    assert.ok(lines.every(line => line.startsWith("v2\t")))
    assert.ok(lines.slice(1).every(line => line.includes("--network none --entrypoint node")))
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
