import assert from "node:assert/strict"
import test from "node:test"
import { resolveDevCommandEnv } from "../dev/run-server-with-env.mjs"
import { serverInfraArgs } from "../dev/server-infra.mjs"
const args = ["--filter", "@synapse/server", "run", "dev"]
test("explicit game E2E database overrides business config and keeps the selected API port", () => {
  const url = "postgresql://test:only@127.0.0.1:5433/game_web_e2e"
  const env = resolveDevCommandEnv(args, { GAME_E2E_DATABASE_URL: url, SYNAPSE_SERVER_API_PORT: "19710" }, { DATABASE_URL: "postgresql://local-business/synapse" })
  assert.equal(env.DATABASE_URL, url)
  assert.equal(env.SYNAPSE_SERVER_API_PORT, "19710")
})
for (const url of ["postgresql://test@remote/game_e2e", "postgresql://test@localhost/synapse"]) {
  test(`rejects non-isolated database ${url}`, () => assert.throws(() => resolveDevCommandEnv(args, { GAME_E2E_DATABASE_URL: url }, {})))
}
test("ordinary development keeps the existing database", () => assert.equal(resolveDevCommandEnv(args, {}, { DATABASE_URL: "existing" }).DATABASE_URL, "existing"))
test("reuse mode starts existing dependency images without rebuilding", () => {
  assert.ok(serverInfraArgs({ SYNAPSE_SERVER_REUSE_INFRA: "1" }).includes("--no-build"))
  assert.ok(!serverInfraArgs({ SYNAPSE_SERVER_REUSE_INFRA: "1" }).includes("--build"))
})
test("ordinary development still builds dependencies", () => assert.ok(serverInfraArgs({}).includes("--build")))
