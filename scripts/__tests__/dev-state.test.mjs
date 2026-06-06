import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  clearDevProcessState,
  readDevProcessState,
  writeDevProcessState,
} from "../dev/dev-state.mjs"

test("writeDevProcessState writes an atomic valid session file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-dev-state-"))
  const statePath = path.join(tempDir, "dev-session.json")

  await writeDevProcessState([
    { pid: 123, processGroupPid: -123, scriptName: "dev:desktop" },
    { pid: 0, processGroupPid: 0, scriptName: "invalid" },
  ], statePath)

  const raw = await readFile(statePath, "utf8")
  assert.deepEqual(JSON.parse(raw), [
    { pid: 123, processGroupPid: -123, scriptName: "dev:desktop" },
  ])
})

test("readDevProcessState treats corrupt state as empty", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-dev-state-"))
  const statePath = path.join(tempDir, "dev-session.json")
  await writeFile(statePath, "[{ bad json", "utf8")

  assert.deepEqual(await readDevProcessState(statePath), [])
})

test("clearDevProcessState removes the requested state file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-dev-state-"))
  const statePath = path.join(tempDir, "dev-session.json")
  await writeFile(statePath, "[]\n", "utf8")

  await clearDevProcessState(statePath)

  assert.deepEqual(await readDevProcessState(statePath), [])
})
