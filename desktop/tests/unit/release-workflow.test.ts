import { readFileSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"
import { describe, expect, it } from "vitest"

const desktopRoot = path.resolve(__dirname, "../..")
const releaseWorkflowPath = path.join(desktopRoot, "../.github/workflows/release.yml")

describe("desktop release workflow", () => {
  it("embeds the production public app URL during installer builds", () => {
    const workflow = parse(readFileSync(releaseWorkflowPath, "utf8")) as {
      readonly jobs?: {
        readonly "build-installers"?: {
          readonly env?: Record<string, string>
        }
      }
    }

    const buildEnv = workflow.jobs?.["build-installers"]?.env ?? {}
    expect(buildEnv.SYNAPSE_DESKTOP_PUBLIC_APP_URL).toBe("https://synapse.d2.pub")
    expect(buildEnv.SYNAPSE_DESKTOP_REQUIRE_PUBLIC_APP_URL).toBe("1")
  })

  it("builds the shared package before split desktop release build steps", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")

    expect(workflowText.indexOf("pnpm --filter @synapse/shared run build"))
      .toBeLessThan(workflowText.indexOf("pnpm --filter @synapse/desktop run build:renderer"))
  })

  it("generates deployment config before building the renderer", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")

    expect(workflowText.indexOf("pnpm --filter @synapse/desktop run generate:deployment-config"))
      .toBeLessThan(workflowText.indexOf("pnpm --filter @synapse/desktop run build:renderer"))
  })

  it("verifies COSCLI checksum before executing the downloaded binary", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")

    expect(workflowText).toContain("COSCLI_VERSION: v1.0.8")
    expect(workflowText).toContain("df0018fbf78b552cbe875ebe26e8bdf7938c7f4394959f913dfc2ea4d1252568")
    expect(workflowText).toContain("https://github.com/tencentyun/coscli/releases/download/${COSCLI_VERSION}/${COSCLI_NAME}")
    expect(workflowText).toContain("coscli-${COSCLI_VERSION}-darwin-arm64")
    expect(workflowText).not.toContain(["coscli", "linux"].join("-"))
    expect(workflowText.indexOf("shasum -a 256 --check -"))
      .toBeLessThan(workflowText.indexOf("\"$RUNNER_TEMP/coscli\" --version"))
  })

  it("does not use Linux runners for release jobs", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")
    const linuxRunner = ["ubuntu", "latest"].join("-")

    expect(workflowText).not.toContain(linuxRunner)
    expect(workflowText).toContain("runs-on: macos-latest")
    expect(workflowText).toContain("os: windows-latest")
  })
})
