import { execFile } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const scriptPath = path.resolve("scripts/build/generate-deployment-config.mjs")

async function runGenerator(env: Record<string, string | undefined>, args: string[] = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-deployment-config-"))
  const outputPath = path.join(dir, "deployment-config.generated.ts")
  const result = await execFileAsync(
    process.execPath,
    [scriptPath, "--output", outputPath, ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: undefined,
        SYNAPSE_DESKTOP_PUBLIC_APP_URL: undefined,
        SYNAPSE_DESKTOP_REQUIRE_PUBLIC_APP_URL: undefined,
        ...env,
      },
    },
  )
  return { ...result, output: await readFile(outputPath, "utf8") }
}

describe("generate-deployment-config", () => {
  it("uses localhost as the development default", async () => {
    const result = await runGenerator({})

    expect(result.output).toContain('publicAppUrl: "http://localhost:3000"')
    expect(result.output).toContain('apiBaseUrl: "http://localhost:3000/api"')
  })

  it("uses the configured public app URL when provided", async () => {
    const result = await runGenerator({
      SYNAPSE_DESKTOP_PUBLIC_APP_URL: "https://synapse.example.com/",
    })

    expect(result.output).toContain('publicAppUrl: "https://synapse.example.com"')
    expect(result.output).toContain('apiBaseUrl: "https://synapse.example.com/api"')
  })

  it("uses an invalid public URL as the CI fallback", async () => {
    const result = await runGenerator({ CI: "true" })

    expect(result.output).toContain('publicAppUrl: "https://synapse.invalid"')
    expect(result.output).toContain('apiBaseUrl: "https://synapse.invalid/api"')
  })

  it("fails release generation when the public app URL is missing", async () => {
    await expect(runGenerator({}, ["--require-public-app-url"]))
      .rejects.toMatchObject({
        stderr: expect.stringContaining("SYNAPSE_DESKTOP_PUBLIC_APP_URL"),
      })
  })
})
