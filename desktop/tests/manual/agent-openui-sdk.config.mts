import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))

// Explicit opt-in: this test uses the user's existing Claude SDK credentials.
export default defineConfig({
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  test: { environment: "jsdom", include: ["tests/manual/agent-openui-sdk.test.mjs"], testTimeout: 180_000 },
})
