import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../../", import.meta.url))
export default defineConfig({ root, resolve: { alias: { "@": path.join(root, "src") } }, test: { environment: "jsdom", include: ["tests/manual/agent-openui-comparison.test.mjs"], testTimeout: 300_000 } })
