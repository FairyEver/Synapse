import assert from "node:assert/strict"
import test from "node:test"

import {
  isServerDevCommand,
  parseEnvFile,
  resolveDevCommandEnv,
} from "../dev/run-server-with-env.mjs"

test("parseEnvFile reads simple local env files", () => {
  assert.deepEqual(parseEnvFile(`
APP_PUBLIC_URL=https://synapse.d2.pub
DATABASE_URL="postgresql://synapse:synapse@localhost:5433/synapse"
IGNORED_WITHOUT_VALUE
`), {
    APP_PUBLIC_URL: "https://synapse.d2.pub",
    DATABASE_URL: "postgresql://synapse:synapse@localhost:5433/synapse",
  })
})

test("resolveDevCommandEnv forces local public host for server dev by default", () => {
  const env = resolveDevCommandEnv(
    ["--filter", "@synapse/server", "run", "dev"],
    {},
    { APP_PUBLIC_URL: "https://synapse.d2.pub", DATABASE_URL: "postgresql://localhost/dev" },
  )

  assert.equal(env.APP_PUBLIC_URL, "http://localhost:3000")
  assert.equal(env.DOCUMENT_PUBLIC_URL, "http://localhost:19773/document")
  assert.equal(env.DATABASE_URL, "postgresql://localhost/dev")
})

test("resolveDevCommandEnv keeps explicit shell public host for server dev", () => {
  const env = resolveDevCommandEnv(
    ["--filter", "@synapse/server", "run", "dev"],
    { APP_PUBLIC_URL: "http://127.0.0.1:3000" },
    { APP_PUBLIC_URL: "https://synapse.d2.pub" },
  )

  assert.equal(env.APP_PUBLIC_URL, "http://127.0.0.1:3000")
})

test("resolveDevCommandEnv keeps an explicit local document host for server dev", () => {
  const env = resolveDevCommandEnv(
    ["--filter", "@synapse/server", "run", "dev"],
    { DOCUMENT_PUBLIC_URL: "http://127.0.0.1:19774/document" },
    { APP_PUBLIC_URL: "https://synapse.d2.pub" },
  )

  assert.equal(env.DOCUMENT_PUBLIC_URL, "http://127.0.0.1:19774/document")
})

test("resolveDevCommandEnv derives the local PDF renderer URL from its mapped port", () => {
  const env = resolveDevCommandEnv(
    ["--filter", "@synapse/server", "run", "dev"],
    {},
    { PDF_RENDERER_HOST_PORT: "3999" },
  )

  assert.equal(env.PDF_RENDERER_URL, "http://127.0.0.1:3999")
})

test("resolveDevCommandEnv keeps an explicit shell PDF renderer URL", () => {
  const env = resolveDevCommandEnv(
    ["--filter", "@synapse/server", "run", "dev"],
    { PDF_RENDERER_HOST_PORT: "3999", PDF_RENDERER_URL: "http://renderer.test:4010" },
    { PDF_RENDERER_HOST_PORT: "3010" },
  )

  assert.equal(env.PDF_RENDERER_URL, "http://renderer.test:4010")
})

test("resolveDevCommandEnv does not rewrite non-server commands", () => {
  const env = resolveDevCommandEnv(
    ["--filter", "@synapse/dashboard", "run", "dev"],
    {},
    { APP_PUBLIC_URL: "https://synapse.d2.pub" },
  )

  assert.equal(env.APP_PUBLIC_URL, "https://synapse.d2.pub")
  assert.equal(isServerDevCommand(["--filter", "@synapse/dashboard", "run", "dev"]), false)
})
