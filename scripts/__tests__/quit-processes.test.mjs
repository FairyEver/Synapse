import assert from "node:assert/strict"
import test from "node:test"

import {
  buildTerminationTargets,
  matchesSynapseDevProcess,
  parsePsRows,
} from "../quit-processes.mjs"

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
    commandLine: "node scripts/dev.mjs",
    cwd: desktopRoot,
  }, { workspaceRoot }), true)

  assert.equal(matchesSynapseDevProcess({
    pid: 202,
    pgid: 202,
    commandLine: "node scripts/dev.mjs",
    cwd: "/tmp/other-project",
  }, { workspaceRoot }), false)

  assert.equal(matchesSynapseDevProcess({
    pid: 203,
    pgid: 203,
    commandLine: "node scripts/quit-processes.mjs",
    cwd: workspaceRoot,
  }, { workspaceRoot }), false)

  assert.equal(matchesSynapseDevProcess({
    pid: 204,
    pgid: 204,
    commandLine: "/Applications/Windsurf.app/Contents/Frameworks/Windsurf Helper (Plugin).app/Contents/MacOS/Windsurf Helper (Plugin) /Users/liyang/.windsurf/extensions/streetsidesoftware.code-spell-checker-4.5.6-universal/packages/_server/dist/main.cjs --node-ipc",
    cwd: workspaceRoot,
  }, { workspaceRoot }), false)
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
    { pid: 20, pgid: 20, commandLine: "node scripts/dev.mjs", cwd: desktopRoot },
    { pid: process.pid, pgid: 30, commandLine: "node scripts/quit-processes.mjs", cwd: workspaceRoot },
  ]), [-10, 20])
})
