import { describe, expect, it } from "vitest"
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  DaemonAdminService,
  MockDaemonDriver,
  parseDaemonInstallArgs,
  parseLaunchdStatusOutput,
  parseSystemdShowOutput,
  resolveDaemonConfig,
} from "../../electron/services/daemon-admin-service"

const defaults = {
  binaryPath: "/opt/cc-connect/cc-connect",
  workDir: "/tmp/work",
  homeDir: "/Users/alice",
  pathEnv: "/usr/bin",
}

describe("daemon admin service", () => {
  it("parses install flags using config parent as work dir", () => {
    expect(parseDaemonInstallArgs(["--config", "/tmp/example/config.toml"])).toEqual({
      config: { workDir: "/tmp/example" },
      force: false,
    })
    expect(parseDaemonInstallArgs(["--config=/tmp/example/config.toml"]).config.workDir).toBe("/tmp/example")
    expect(parseDaemonInstallArgs([
      "--config",
      "/tmp/example/config.toml",
      "--work-dir",
      "/tmp/override",
      "--force",
    ])).toEqual({
      config: { workDir: "/tmp/override" },
      force: true,
    })
    expect(parseDaemonInstallArgs(["--log-max-size=12"]).config.logMaxSize).toBe(12 * 1024 * 1024)
    expect(() => parseDaemonInstallArgs(["--unknown"])).toThrow("unknown flag: --unknown")
  })

  it("renders launchd plist and systemd unit without installing a real service", () => {
    const config = resolveDaemonConfig({}, defaults)

    const plist = buildLaunchdPlist(config)
    expect(plist).toContain("<key>SuccessfulExit</key>")
    expect(plist).not.toContain("<key>KeepAlive</key>\n\t<true/>")
    expect(plist).toContain("<string>/opt/cc-connect/cc-connect</string>")

    const unit = buildSystemdUnit({
      ...config,
      envExtra: { HTTPS_PROXY: "http://proxy", HTTP_PROXY: "http://proxy" },
    }, false)
    expect(unit).toContain("ExecStart=/opt/cc-connect/cc-connect")
    expect(unit).toContain("Environment=\"HTTP_PROXY=http://proxy\"")
    expect(unit).toContain("Environment=\"HTTPS_PROXY=http://proxy\"")
    expect(unit).toContain("WantedBy=default.target")
  })

  it("maps launchd and systemd status output", () => {
    expect(parseLaunchdStatusOutput("pid = 123\nstate = running", true)).toEqual({
      installed: true,
      running: true,
      pid: 123,
      platform: "launchd",
    })
    expect(parseSystemdShowOutput("ActiveState=active\nMainPID=456", true, "systemd (user)")).toEqual({
      installed: true,
      running: true,
      pid: 456,
      platform: "systemd (user)",
    })
  })

  it("blocks unsafe lifecycle operations unless status allows them", async () => {
    const driver = new MockDaemonDriver({ installed: true, running: true, pid: 111 })
    const service = new DaemonAdminService(driver, defaults)

    await expect(service.install({}, { force: false })).resolves.toMatchObject({
      ok: false,
      message: "Service already installed. Use --force to reinstall.",
    })
    expect(driver.operations).toEqual([])

    await expect(service.install({}, { force: true })).resolves.toMatchObject({
      ok: true,
      status: { installed: true, running: true },
    })
    expect(driver.operations).toEqual(["install"])

    const missingDriver = new MockDaemonDriver({ installed: false })
    const missingService = new DaemonAdminService(missingDriver, defaults)
    await expect(missingService.start()).resolves.toMatchObject({
      ok: false,
      message: "Service is not installed. Run daemon install first.",
    })
    expect(missingDriver.operations).toEqual([])
  })

  it("surfaces install denial through the mock driver", async () => {
    const driver = new MockDaemonDriver({ installed: false, running: false })
    driver.nextError = new Error("permission denied")
    const service = new DaemonAdminService(driver, defaults)

    await expect(service.install()).resolves.toMatchObject({
      ok: false,
      message: "Install failed: permission denied",
      status: { installed: false, running: false },
    })
    expect(driver.operations).toEqual(["install"])
  })
})
