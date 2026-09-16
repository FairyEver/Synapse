import { execFile } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const scriptPath = path.resolve("scripts/build/generate-deployment-config.mjs")

async function runGenerator(
  env: Record<string, string | undefined>,
  args: string[] = [],
  options: { readonly outputPath?: string } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-deployment-config-"))
  const outputPath = options.outputPath ?? path.join(dir, "deployment-config.generated.ts")
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
  return { ...result, output: await readFile(outputPath, "utf8"), outputPath }
}

async function freshOutputPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-deployment-config-"))
  return path.join(dir, "deployment-config.generated.ts")
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

  it("keeps an existing deployment config when the variable is missing", async () => {
    const outputPath = await freshOutputPath()
    await runGenerator({ SYNAPSE_DESKTOP_PUBLIC_APP_URL: "https://synapse.example.com" }, [], { outputPath })

    const rebuilt = await runGenerator({}, [], { outputPath })

    expect(rebuilt.output).toContain('publicAppUrl: "https://synapse.example.com"')
    expect(rebuilt.output).toContain('apiBaseUrl: "https://synapse.example.com/api"')
    expect(rebuilt.stdout).toContain("keeping the existing deployment config (https://synapse.example.com)")
    expect(rebuilt.stderr).not.toContain("Falling back")
  })

  it("warns visibly when neither the variable nor an existing config is present", async () => {
    const result = await runGenerator({})

    expect(result.output).toContain('publicAppUrl: "http://localhost:3000"')
    expect(result.stderr).toContain("SYNAPSE_DESKTOP_PUBLIC_APP_URL is not set")
    expect(result.stderr).toContain("no deployment config exists yet")
  })

  it("still lets an explicit variable win over an existing config", async () => {
    const outputPath = await freshOutputPath()
    await runGenerator({ SYNAPSE_DESKTOP_PUBLIC_APP_URL: "https://synapse.example.com" }, [], { outputPath })

    const rebuilt = await runGenerator({ SYNAPSE_DESKTOP_PUBLIC_APP_URL: "https://other.example.com" }, [], { outputPath })

    expect(rebuilt.output).toContain('publicAppUrl: "https://other.example.com"')
    expect(rebuilt.stdout).not.toContain("keeping the existing deployment config")
  })
})
