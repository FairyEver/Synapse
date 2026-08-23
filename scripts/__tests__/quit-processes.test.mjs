import assert from "node:assert/strict"
import test from "node:test"

import {
  buildTerminationTargets,
  filterRemainingDevProcessState,
  filterSynapseDevProcessRows,
  matchesSynapseDevProcess,
  parsePsRows,
} from "../dev/quit-processes.mjs"

const workspaceRoot = "/Users/liyang/Documents/code/github/Synapse"
const desktopRoot = `${workspaceRoot}/desktop`

test("matchesSynapseDevProcess matches workspace Electron only", () => {
  assert.equal(matchesSynapseDevProcess({
    pid: 101,
    pgid: 101,
    commandLine: `${workspaceRoot}/node_modules/.pnpm/electron@41.2.1/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`,
    cwd: desktopRoot,
  }, { workspaceRoot }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 102,
    pgid: 102,
    commandLine: "/System/Library/PrivateFrameworks/Synapse.framework/Support/contentlinkingd",
    cwd: "/",
  }, { workspaceRoot }), false)
})

test("matchesSynapseDevProcess requires workspace cwd for relative dev scripts", () => {
  assert.equal(matchesSynapseDevProcess({
    pid: 201,
    pgid: 201,
    commandLine: "node scripts/dev/dev.mjs",
    cwd: desktopRoot,
  }, { workspaceRoot }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 202,
    pgid: 202,
    commandLine: "node scripts/dev/dev.mjs",
    cwd: "/tmp/other-project",
  }, { workspaceRoot }), false)

  assert.equal(matchesSynapseDevProcess({
    pid: 203,
    pgid: 203,
    commandLine: "node scripts/dev/quit-processes.mjs",
    cwd: workspaceRoot,
  }, { workspaceRoot }), false)

  assert.equal(matchesSynapseDevProcess({
    pid: 204,
    pgid: 204,
    commandLine: "/Applications/Windsurf.app/Contents/Frameworks/Windsurf Helper (Plugin).app/Contents/MacOS/Windsurf Helper (Plugin) /Users/liyang/.windsurf/extensions/streetsidesoftware.code-spell-checker-4.5.6-universal/packages/_server/dist/main.cjs --node-ipc",
    cwd: workspaceRoot,
  }, { workspaceRoot }), false)
})

test("matchesSynapseDevProcess filters by requested dev script", () => {
  assert.equal(matchesSynapseDevProcess({
    pid: 301,
    pgid: 301,
    commandLine: "pnpm --filter @synapse/document run dev",
    cwd: workspaceRoot,
  }, { workspaceRoot, targetScripts: ["dev:document"] }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 302,
    pgid: 302,
    commandLine: "vitepress dev",
    cwd: `${workspaceRoot}/document`,
  }, { workspaceRoot, targetScripts: ["dev:document"] }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 303,
    pgid: 303,
    commandLine: "vitepress dev",
    cwd: `${workspaceRoot}/document`,
  }, { workspaceRoot, targetScripts: ["dev:desktop"] }), false)

  assert.equal(matchesSynapseDevProcess({
    pid: 304,
    pgid: 304,
    commandLine: "node scripts/dev/dev-renderer.mjs",
    cwd: `${workspaceRoot}/desktop`,
  }, { workspaceRoot, targetScripts: ["dev:desktop"] }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 305,
    pgid: 305,
    commandLine: "node scripts/dev/run-server-with-env.mjs --filter @synapse/server run dev",
    cwd: workspaceRoot,
  }, { workspaceRoot, targetScripts: ["dev:server"] }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 306,
    pgid: 306,
    commandLine: `node ${workspaceRoot}/dashboard/node_modules/.bin/../vite/bin/vite.js --port 3000 --host 0.0.0.0 --open /console/`,
    cwd: `${workspaceRoot}/dashboard`,
  }, { workspaceRoot, targetScripts: ["dev:server"] }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 307,
    pgid: 307,
    commandLine: `node ${workspaceRoot}/dashboard/node_modules/.bin/../vite/bin/vite.js --port 3000 --host 0.0.0.0 --open /console/`,
    cwd: `${workspaceRoot}/dashboard`,
  }, { workspaceRoot, targetScripts: ["dev:desktop"] }), false)
})

test("filterSynapseDevProcessRows applies requested dev script targets", () => {
  const rows = [
    {
      pid: 401,
      pgid: 401,
      commandLine: "node scripts/dev/run-server-with-env.mjs --filter @synapse/server run dev",
      cwd: workspaceRoot,
    },
    {
      pid: 402,
      pgid: 402,
      commandLine: "node scripts/dev/dev-renderer.mjs",
      cwd: `${workspaceRoot}/desktop`,
    },
    {
      pid: 403,
      pgid: 403,
      commandLine: "vitepress dev",
      cwd: `${workspaceRoot}/document`,
    },
  ]

  assert.deepEqual(
    filterSynapseDevProcessRows(rows, { workspaceRoot, targetScripts: ["dev:server"] })
      .map((row) => row.pid),
    [401],
  )
})

test("parsePsRows preserves commands with spaces", () => {
  assert.deepEqual(parsePsRows("  29931  29921  26199 /path/Electron .\n"), [
    {
      pid: 29931,
      ppid: 29921,
      pgid: 26199,
      commandLine: "/path/Electron .",
    },
  ])
})

test("buildTerminationTargets keeps tracked process groups and scanned pids", () => {
  assert.deepEqual(buildTerminationTargets([
    { pid: 10, processGroupPid: -10, scriptName: "dev:desktop" },
  ], [
    { pid: 20, pgid: 20, commandLine: "node scripts/dev/dev.mjs", cwd: desktopRoot },
    { pid: process.pid, pgid: 30, commandLine: "node scripts/dev/quit-processes.mjs", cwd: workspaceRoot },
  ]), [-10, 20])
})

test("filterRemainingDevProcessState keeps unrelated tracked dev scripts", () => {
  assert.deepEqual(filterRemainingDevProcessState([
    { pid: 10, processGroupPid: -10, scriptName: "dev:server" },
    { pid: 20, processGroupPid: -20, scriptName: "dev:desktop" },
    { pid: 30, processGroupPid: -30, scriptName: "dev:document" },
  ], ["dev:server"]), [
    { pid: 20, processGroupPid: -20, scriptName: "dev:desktop" },
    { pid: 30, processGroupPid: -30, scriptName: "dev:document" },
  ])

  assert.deepEqual(filterRemainingDevProcessState([
    { pid: 10, processGroupPid: -10, scriptName: "dev:server" },
  ], []), [])
})
