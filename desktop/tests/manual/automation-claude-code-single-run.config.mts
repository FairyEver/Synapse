import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))

// Explicit opt-in: starts real CLI processes and uses existing local Claude Code credentials.
export default defineConfig({
  root,
  resolve: { alias: { "@": path.join(root, "src") } },
  test: { environment: "node", include: ["tests/manual/automation-claude-code-single-run.test.mjs"], testTimeout: 90_000 },
})
