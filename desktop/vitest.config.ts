import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: [
      "app-capabilities/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "workflow-nodes/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "action-packages/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "action-packages/**/*.test.{ts,tsx}",
      "electron/**/__tests__/**/*.{test,spec}.ts",
      "synapse-capabilities/**/*.test.ts",
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "tests/unit/**/*.{test,spec}.ts",
      "tests/ipc/**/*.{test,spec}.ts",
      "tests/perf/**/*.{test,spec}.ts",
      "tests/fuzz/**/*.{test,spec}.ts",
    ],
    exclude: ["node_modules", "dist", "dist-electron"],
    reporters: process.env.CI ? ["default"] : ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["electron/runtime/**/*", "electron/services/**/*"],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts"],
    },
  },
})
