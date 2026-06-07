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
})
