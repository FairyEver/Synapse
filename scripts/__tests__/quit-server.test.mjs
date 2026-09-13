import assert from "node:assert/strict"
import test from "node:test"
import { quitServer } from "../dev/quit-server.mjs"
import { resolvePnpmInvocation } from "../dev/process-utils.mjs"

test("server shutdown passes defaults through env and preserves literal command arguments", async () => {
  const calls = []
  const env = { PATH: "fixture", APP_PUBLIC_URL: "", PDF_RENDERER_INTERNAL_SECRET: "" }
  const result = await quitServer({ cwd: "C:\\Project Space & 中文", env, run: async (...args) => {
    calls.push(args); return { code: 0, signal: null }
  } })
  assert.equal(result.code, 0)
  assert.equal(calls[0][0], process.execPath)
  assert.equal(calls[0][1][1], "dev:server")
  assert.equal(calls[1][0], "docker")
  assert.deepEqual(calls[1][1], ["compose", "--env-file", "server/.env.local", "-f", "server/compose.yml", "-f", "server/compose.dev.yml", "down"])
  assert.equal(calls[1][2].cwd, "C:\\Project Space & 中文")
  assert.equal(calls[1][2].env.APP_PUBLIC_URL, "http://localhost:3000")
  assert.ok(calls[1][2].env.PDF_RENDERER_INTERNAL_SECRET)
  assert.equal(env.APP_PUBLIC_URL, "")
})

test("server shutdown preserves explicit env and stops if process cleanup fails", async () => {
  let calls = 0
  assert.deepEqual(await quitServer({ run: async () => { calls++; return { code: 7, signal: null } } }), { code: 7, signal: null })
  assert.equal(calls, 1)
  const env = { APP_PUBLIC_URL: "http://localhost:3456", PDF_RENDERER_INTERNAL_SECRET: "synthetic-explicit-value" }
  await quitServer({ env, run: async (command, args, options) => {
    if (command === "docker") assert.deepEqual(options.env, env)
    return { code: 0, signal: null }
  } })
  await assert.rejects(quitServer({ run: async () => { throw new Error("spawn failed") } }), /spawn failed/)
})

for (const platform of ["darwin", "win32"]) {
  test(`${platform} pnpm launcher keeps metacharacters as literal arguments without a shell`, () => {
    const launcher = platform === "win32" ? String.raw`C:\Tools & Space\pnpm.cjs` : "/Tools & Space/pnpm.cjs"
    const args = ["run", "quit:server", "literal & value", "%UNEXPANDED%"]
    assert.deepEqual(resolvePnpmInvocation(args, { npm_execpath: launcher }, platform, "node-fixture"), {
      command: "node-fixture", args: [launcher, ...args],
    })
  })
}
test("unsupported Windows direct invocation reports missing pnpm launcher instead of spawning a cmd file", () => {
  assert.throws(() => resolvePnpmInvocation(["run", "quit:server"], {}, "win32"), /root pnpm/)
  assert.deepEqual(resolvePnpmInvocation(["run", "quit:server"], {}, "darwin"), { command: "pnpm", args: ["run", "quit:server"] })
})


test("Windows standalone pnpm executable keeps direct argv without Node or cmd", () => {
  const launcher = String.raw`C:\Tools & Space\pnpm.exe`
  assert.deepEqual(resolvePnpmInvocation(["run", "quit:server"], { npm_execpath: launcher }, "win32"), {
    command: launcher, args: ["run", "quit:server"],
  })
})
