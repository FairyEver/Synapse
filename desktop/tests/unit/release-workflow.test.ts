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
    expect(workflowText).toContain("7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91")
    expect(workflowText).toContain("https://github.com/tencentyun/coscli/releases/download/${COSCLI_VERSION}/${COSCLI_NAME}")
    expect(workflowText).not.toContain("cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64")
    expect(workflowText.indexOf("sha256sum --check -"))
      .toBeLessThan(workflowText.indexOf("\"$RUNNER_TEMP/coscli\" --version"))
  })
})
