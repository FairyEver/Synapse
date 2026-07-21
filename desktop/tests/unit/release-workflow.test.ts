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
    expect(workflowText).toContain("os: windows-2022")
  })

  it("prunes old COS release versions after publishing release notes", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")

    expect(workflowText).toContain("Prune old COS release versions")
    expect(workflowText).toContain("scripts/release/prune-cos-release-versions.mjs")
    expect(workflowText.indexOf("Upload release artifacts to COS"))
      .toBeLessThan(workflowText.indexOf("Refresh and verify CDN"))
    expect(workflowText.indexOf("Refresh and verify CDN"))
      .toBeLessThan(workflowText.indexOf("Publish release notes"))
    expect(workflowText.indexOf("Publish release notes"))
      .toBeLessThan(workflowText.indexOf("Prune old COS release versions"))
  })

  it("validates the stable update link in the release body without probing production", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")
    const gateStep = workflowText.indexOf("Verify release body")
    const publishStep = workflowText.indexOf("Publish release notes")

    expect(workflowText).toContain("DESKTOP_UPDATE_HANDOFF_URL: https://synapse.d2.pub/desktop/update")
    expect(workflowText).toContain('一键更新：${DESKTOP_UPDATE_HANDOFF_URL}')
    expect(workflowText).toContain("synapse://")
    expect(workflowText).toContain("desktop/update[?#]")
    expect(workflowText).not.toContain("%{url_effective}")
    expect(workflowText).not.toContain("HANDOFF_BODY")
    expect(gateStep).toBeGreaterThan(-1)
    expect(publishStep).toBeGreaterThan(gateStep)
  })

  it("smoke-tests cold and hot update protocol launches before uploading packaged artifacts", () => {
    const workflowText = readFileSync(releaseWorkflowPath, "utf8")
    const packagedCheck = workflowText.indexOf("Verify packaged app")
    const macSmoke = workflowText.indexOf("Smoke macOS packaged update protocol")
    const windowsSmoke = workflowText.indexOf("Smoke Windows packaged update protocol")
    const artifactUpload = workflowText.indexOf("Upload release artifacts")

    expect(workflowText).toContain("CFBundleURLSchemes")
    expect(workflowText).toContain('"$LSREGISTER" -f')
    expect(workflowText).toContain('open "$UPDATE_DEEP_LINK"')
    expect(workflowText).toContain("Registry::HKEY_CURRENT_USER\\Software\\Classes\\synapse\\shell\\open\\command")
    expect(workflowText).toContain("Start-Process $updateDeepLink")
    expect(workflowText).toContain("cold update protocol launch")
    expect(workflowText).toContain("hot update protocol launch")
    expect(workflowText).toContain('APP_MOUNTED_LOG="App mounted."')
    expect(workflowText).toContain("Update open request navigated to About Synapse.")
    expect(workflowText).toContain("wait_for_synapse_exit")
    expect(workflowText).toContain('wait_for_log "$APP_MOUNTED_LOG"')
    expect(workflowText).toContain("wait_for_navigation_log")
    expect(workflowText).toContain("Wait-NavigationLog")
    expect(workflowText).toContain('2>/dev/null || true')
    expect(macSmoke).toBeGreaterThan(packagedCheck)
    expect(windowsSmoke).toBeGreaterThan(packagedCheck)
    expect(artifactUpload).toBeGreaterThan(macSmoke)
    expect(artifactUpload).toBeGreaterThan(windowsSmoke)
  })
})
