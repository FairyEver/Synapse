import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const source = readFileSync(new URL("../../deploy.sh", import.meta.url), "utf8")
const current = "deploy-20261106_120000"
const image = (repository, tag, number) => ({ repository, tag, id: `sha256:${number.toString(16).padStart(64, "0")}` })
const fixtures = () => ["synapse-server", "synapse-pdf-renderer"].flatMap((repository, index) => [
  image(repository, current, 100 + index),
  image(repository, "rollback-20261106_120000", 80 + index),
  image(repository, "rollback-20261105_120000", 60 + index),
  image(repository, "rollback-20261104_120000", 40 + index),
  image(repository, "rollback-20261103_120000", 20 + index),
  image(repository, "deploy-20261102_120000", 20 + index),
])

function runCleanup({ images = fixtures(), containers = [], fail = "", appearOnRecheck, retagOnInspect } = {}) {
  const body = source.match(/\ncleanup_remote_images\(\) \{[\s\S]*?<<'REMOTE_SCRIPT'\n([\s\S]*?)\nREMOTE_SCRIPT/u)?.[1]
  assert.ok(body, "deploy.sh must define the remote image cleanup")
  const dir = mkdtempSync(join(tmpdir(), "synapse-image-cleanup-"))
  try {
    const statePath = join(dir, "state.json")
    writeFileSync(statePath, JSON.stringify({ images, containers, fail, appearOnRecheck, retagOnInspect, lists: 0, removals: [] }))
    const executable = join(dir, "docker")
    writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs')
const path = process.env.FAKE_DOCKER_STATE
const state = JSON.parse(fs.readFileSync(path, 'utf8'))
const args = process.argv.slice(2)
const command = args.slice(0, 2).join(' ')
if (state.fail === command) { process.stderr.write('synthetic Docker failure\\n'); process.exit(7) }
if (command === 'image ls') {
  process.stdout.write(state.images.map(i => [i.repository, i.tag, i.id].join(' ')).join('\\n'))
} else if (command === 'container ls') {
  if (!args.includes('--all') || !args.includes('--quiet')) throw new Error('all containers must be enumerated')
  state.lists++
  if (state.lists > 1 && state.appearOnRecheck && !state.containers.some(c => c.name === state.appearOnRecheck.name)) state.containers.push(state.appearOnRecheck)
  process.stdout.write(state.containers.map(c => c.name).join('\\n'))
} else if (command === 'container inspect') {
  const names = args.slice(args.indexOf('--format') + 2)
  process.stdout.write(names.map(name => {
    const container = state.containers.find(c => c.name === name)
    if (!container) throw new Error('container not found')
    return container.id
  }).join('\\n'))
} else if (command === 'image inspect') {
  const ref = args.at(-1)
  const entry = state.images.find(i => i.repository + ':' + i.tag === ref)
  if (!entry) throw new Error('image not found')
  if (state.retagOnInspect?.ref === ref) entry.id = state.retagOnInspect.id
  process.stdout.write(entry.id)
} else if (command === 'image rm') {
  if (args.includes('--force') || args.includes('-f') || !args.includes('--no-prune')) throw new Error('unsafe removal')
  const ref = args.at(-1)
  const entry = state.images.find(i => i.repository + ':' + i.tag === ref)
  if (!entry) throw new Error('image not found')
  if (state.containers.some(c => c.id === entry.id)) throw new Error('container image must not be removed')
  state.removals.push(ref)
  state.images = state.images.filter(i => i !== entry)
} else { throw new Error('unexpected Docker command: ' + args.join(' ')) }
fs.writeFileSync(path, JSON.stringify(state))
`)
    chmodSync(executable, 0o755)
    const result = spawnSync("bash", ["-s"], {
      input: body, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_DOCKER_STATE: statePath, NEW_IMAGE_TAG: current },
    })
    return { result, state: JSON.parse(readFileSync(statePath, "utf8")) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("keeps the current image and three newest rollback tags in each repository", () => {
  const { result, state } = runCleanup({ images: fixtures().reverse() })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(state.removals.sort(), [
    "synapse-pdf-renderer:deploy-20261102_120000", "synapse-pdf-renderer:rollback-20261103_120000",
    "synapse-server:deploy-20261102_120000", "synapse-server:rollback-20261103_120000",
  ])
  assert.equal(state.images.length, 8)
})

test("protects image IDs referenced by running and stopped containers, including aliases", () => {
  const images = fixtures()
  const containers = [{ name: "running", id: images[4].id }, { name: "stopped", id: images[10].id }]
  const { result, state } = runCleanup({ images, containers })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(state.removals, [])
})

test("does not delete other repositories, custom tags, or aliases of retained images", () => {
  const images = fixtures()
  const additions = [image("unrelated", "deploy-20261101_120000", 10), image("synapse-server", "manual", 11),
    { ...images[1], tag: "deploy-20261101_120000" }, { ...images[0], tag: "rollback-20261001_120000" }]
  const { result, state } = runCleanup({ images: [...images, ...additions] })
  assert.equal(result.status, 0, result.stderr)
  for (const entry of additions) assert.ok(state.images.some(i => i.repository === entry.repository && i.tag === entry.tag))
})

test("does not delete anything if either current deployment image is missing", () => {
  const { result, state } = runCleanup({ images: fixtures().filter(i => i.repository !== "synapse-pdf-renderer" || i.tag !== current) })
  assert.notEqual(result.status, 0)
  assert.deepEqual(state.removals, [])
})

for (const fail of ["image ls", "container ls", "container inspect", "image inspect", "image rm"]) {
  test(`stops cleanup when ${fail} fails`, () => {
    const { result, state } = runCleanup({ fail, containers: [{ name: "current", id: fixtures()[0].id }] })
    assert.notEqual(result.status, 0)
    assert.deepEqual(state.removals, [])
  })
}

test("rechecks container references before removing each old tag", () => {
  const { result, state } = runCleanup({ appearOnRecheck: { name: "new-container", id: fixtures()[4].id } })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(state.images.some(i => i.repository === "synapse-server" && i.tag === "rollback-20261103_120000"))
})

test("skips a tag retargeted since the initial inventory", () => {
  const ref = "synapse-server:rollback-20261103_120000"
  const { result, state } = runCleanup({ retagOnInspect: { ref, id: fixtures()[0].id } })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!state.removals.includes(ref))
})

test("supports a first deployment with fewer than three rollback versions", () => {
  const { result, state } = runCleanup({ images: fixtures().filter(i => i.tag === current) })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(state.removals, [])
})

function finishDeployment(healthy, cleanupSuccess) {
  const tail = source.slice(source.indexOf("# [19/19] 健康检查"))
  return spawnSync("bash", ["-s"], {
    encoding: "utf8", timeout: 5_000,
    input: `set -euo pipefail
TOTAL_STEPS=19
TOTAL_START=$(date +%s)
run_deployed_health_check() { ${healthy ? "true" : "false"}; }
cleanup_remote_images() { echo CLEANUP; ${cleanupSuccess ? "true" : "false"}; }
recover_previous_service_after_failure() { echo ROLLBACK; }
print_deployment_artifacts() { :; }
${tail}`,
  })
}

test("only cleans up after health checks pass and does not roll back on cleanup failure", () => {
  const unhealthy = finishDeployment(false, true)
  assert.notEqual(unhealthy.status, 0)
  assert.ok(!unhealthy.stdout.includes("CLEANUP"))
  assert.ok(unhealthy.stdout.includes("ROLLBACK"))
  for (const success of [true, false]) {
    const result = finishDeployment(true, success)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes("CLEANUP"))
    assert.ok(!result.stdout.includes("ROLLBACK"))
    if (!success) assert.match(result.stdout + result.stderr, /清理.*失败/u)
  }
})
