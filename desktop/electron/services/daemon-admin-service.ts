import path from "node:path"

export type DaemonPlatform = "launchd" | "systemd (system)" | "systemd (user)" | "unsupported"

export type DaemonConfig = {
  binaryPath?: string
  workDir?: string
  logFile?: string
  logMaxSize?: number
  envPATH?: string
  envExtra?: Record<string, string>
}

export type ResolvedDaemonConfig = Required<Omit<DaemonConfig, "envExtra">> & {
  envExtra: Record<string, string>
}

export type DaemonStatus = {
  installed: boolean
  running: boolean
  pid: number
  platform: DaemonPlatform
}

export type DaemonInstallArgs = {
  config: DaemonConfig
  force: boolean
}

export type DaemonOperationResult = {
  ok: boolean
  message: string
  status?: DaemonStatus
}

export type DaemonDriver = {
  platform: () => DaemonPlatform
  status: () => Promise<DaemonStatus> | DaemonStatus
  install: (config: ResolvedDaemonConfig) => Promise<void> | void
  uninstall: () => Promise<void> | void
  start: () => Promise<void> | void
  stop: () => Promise<void> | void
  restart: () => Promise<void> | void
}

const DEFAULT_LOG_MAX_SIZE = 10 * 1024 * 1024
const LAUNCHD_LABEL = "com.cc-connect.service"
const SYSTEMD_SERVICE_NAME = "cc-connect.service"

function flagValue(args: readonly string[], index: number, flagName: string): { value: string; next: number } {
  const next = index + 1
  if (next >= args.length) {
    throw new Error(`missing value for ${flagName}`)
  }

  return { value: args[next], next }
}

function parsePositiveMegabytes(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid value for ${flagName}: ${value}`)
  }

  return parsed * 1024 * 1024
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseDaemonInstallArgs(args: readonly string[]): DaemonInstallArgs {
  const config: DaemonConfig = {}
  let force = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (true) {
      case arg === "--force":
        force = true
        break
      case arg === "--log-file": {
        const parsed = flagValue(args, i, "--log-file")
        config.logFile = parsed.value
        i = parsed.next
        break
      }
      case arg.startsWith("--log-file="):
        config.logFile = arg.slice("--log-file=".length)
        break
      case arg === "--log-max-size": {
        const parsed = flagValue(args, i, "--log-max-size")
        config.logMaxSize = parsePositiveMegabytes(parsed.value, "--log-max-size")
        i = parsed.next
        break
      }
      case arg.startsWith("--log-max-size="):
        config.logMaxSize = parsePositiveMegabytes(arg.slice("--log-max-size=".length), "--log-max-size")
        break
      case arg === "--work-dir": {
        const parsed = flagValue(args, i, "--work-dir")
        config.workDir = path.normalize(parsed.value)
        i = parsed.next
        break
      }
      case arg.startsWith("--work-dir="):
        config.workDir = path.normalize(arg.slice("--work-dir=".length))
        break
      case arg === "--config" || arg === "-config": {
        const parsed = flagValue(args, i, arg)
        config.workDir = path.dirname(parsed.value)
        i = parsed.next
        break
      }
      case arg.startsWith("--config="):
        config.workDir = path.dirname(arg.slice("--config=".length))
        break
      case arg.startsWith("-config="):
        config.workDir = path.dirname(arg.slice("-config=".length))
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  return { config, force }
}

export function resolveDaemonConfig(
  config: DaemonConfig,
  defaults: {
    binaryPath: string
    workDir: string
    homeDir: string
    pathEnv?: string
    envExtra?: Record<string, string>
  },
): ResolvedDaemonConfig {
  return {
    binaryPath: config.binaryPath || defaults.binaryPath,
    workDir: config.workDir || defaults.workDir,
    logFile: config.logFile || path.join(defaults.homeDir, ".cc-connect", "logs", "cc-connect.log"),
    logMaxSize: config.logMaxSize && config.logMaxSize > 0 ? config.logMaxSize : DEFAULT_LOG_MAX_SIZE,
    envPATH: config.envPATH || defaults.pathEnv || "",
    envExtra: config.envExtra ?? defaults.envExtra ?? {},
  }
}

export function parseSystemdShowOutput(output: string, installed: boolean, platform: DaemonPlatform): DaemonStatus {
  const props = new Map<string, string>()

  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=")
    if (separator < 0) {
      continue
    }
    props.set(line.slice(0, separator), line.slice(separator + 1))
  }

  const pid = Number.parseInt(props.get("MainPID") ?? "", 10)
  return {
    installed,
    running: props.get("ActiveState")?.toLowerCase() === "active",
    pid: Number.isFinite(pid) && pid > 0 ? pid : 0,
    platform,
  }
}

export function parseLaunchdStatusOutput(output: string, installed: boolean): DaemonStatus {
  let pid = 0
  let running = false

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith("pid = ")) {
      const parsed = Number.parseInt(line.slice("pid = ".length), 10)
      if (Number.isFinite(parsed) && parsed > 0) {
        pid = parsed
        running = true
      }
    }
    if (line.includes("state = running")) {
      running = true
    }
  }

  return { installed, running, pid, platform: "launchd" }
}

export function buildLaunchdPlist(config: ResolvedDaemonConfig): string {
  const envPATH = config.envPATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LAUNCHD_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${config.binaryPath}</string>
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${config.workDir}</string>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<dict>
\t\t<key>SuccessfulExit</key>
\t\t<true/>
\t</dict>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>CC_LOG_FILE</key>
\t\t<string>${config.logFile}</string>
\t\t<key>CC_LOG_MAX_SIZE</key>
\t\t<string>${config.logMaxSize}</string>
\t\t<key>PATH</key>
\t\t<string>${envPATH}</string>
\t</dict>
\t<key>StandardOutPath</key>
\t<string>/dev/null</string>
\t<key>StandardErrorPath</key>
\t<string>/dev/null</string>
</dict>
</plist>
`
}

export function buildSystemdUnit(config: ResolvedDaemonConfig, system: boolean): string {
  const envExtra = Object.entries(config.envExtra)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `Environment="${key}=${value}"`)
    .join("\n")

  return [
    "[Unit]",
    "Description=cc-connect - AI Agent Chat Bridge",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${config.binaryPath}`,
    `WorkingDirectory=${config.workDir}`,
    "Restart=on-failure",
    "RestartSec=10",
    `Environment="CC_LOG_FILE=${config.logFile}"`,
    `Environment="CC_LOG_MAX_SIZE=${config.logMaxSize}"`,
    config.envPATH ? `Environment="PATH=${config.envPATH}"` : "",
    envExtra,
    "",
    "[Install]",
    system ? "WantedBy=multi-user.target" : "WantedBy=default.target",
    "",
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n")
}

export class DaemonAdminService {
  private readonly driver: DaemonDriver
  private readonly defaults: Parameters<typeof resolveDaemonConfig>[1]

  constructor(driver: DaemonDriver, defaults: Parameters<typeof resolveDaemonConfig>[1]) {
    this.driver = driver
    this.defaults = defaults
  }

  async status(): Promise<DaemonStatus> {
    return this.driver.status()
  }

  async install(config: DaemonConfig = {}, options: { force?: boolean } = {}): Promise<DaemonOperationResult> {
    const current = await this.driver.status()
    if (current.installed && !options.force) {
      return {
        ok: false,
        message: "Service already installed. Use --force to reinstall.",
        status: current,
      }
    }

    try {
      const resolved = resolveDaemonConfig(config, this.defaults)
      await this.driver.install(resolved)
      return {
        ok: true,
        message: "cc-connect daemon installed and started.",
        status: await this.driver.status(),
      }
    } catch (error) {
      return { ok: false, message: `Install failed: ${errorMessage(error)}`, status: await this.driver.status() }
    }
  }

  async uninstall(): Promise<DaemonOperationResult> {
    const current = await this.driver.status()
    if (!current.installed) {
      return { ok: true, message: "Service is not installed.", status: current }
    }

    try {
      await this.driver.uninstall()
      return { ok: true, message: "cc-connect daemon uninstalled.", status: await this.driver.status() }
    } catch (error) {
      return { ok: false, message: `Uninstall failed: ${errorMessage(error)}`, status: await this.driver.status() }
    }
  }

  async start(): Promise<DaemonOperationResult> {
    return this.requireInstalledThen("start", "cc-connect daemon started.", () => this.driver.start())
  }

  async stop(): Promise<DaemonOperationResult> {
    return this.requireInstalledThen("stop", "cc-connect daemon stopped.", () => this.driver.stop())
  }

  async restart(): Promise<DaemonOperationResult> {
    return this.requireInstalledThen("restart", "cc-connect daemon restarted.", () => this.driver.restart())
  }

  private async requireInstalledThen(
    operation: "start" | "stop" | "restart",
    successMessage: string,
    action: () => Promise<void> | void,
  ): Promise<DaemonOperationResult> {
    const current = await this.driver.status()
    if (!current.installed) {
      return {
        ok: false,
        message: "Service is not installed. Run daemon install first.",
        status: current,
      }
    }

    try {
      await action()
      return { ok: true, message: successMessage, status: await this.driver.status() }
    } catch (error) {
      return { ok: false, message: `${operation[0].toUpperCase()}${operation.slice(1)} failed: ${errorMessage(error)}`, status: await this.driver.status() }
    }
  }
}

export class MockDaemonDriver implements DaemonDriver {
  readonly operations: string[] = []
  nextError: Error | null = null
  private currentStatus: DaemonStatus

  constructor(status: Partial<DaemonStatus> = {}) {
    this.currentStatus = {
      installed: status.installed ?? false,
      running: status.running ?? false,
      pid: status.pid ?? 0,
      platform: status.platform ?? "launchd",
    }
  }

  platform(): DaemonPlatform {
    return this.currentStatus.platform
  }

  status(): DaemonStatus {
    return { ...this.currentStatus }
  }

  install(): void {
    this.run("install", () => {
      this.currentStatus = {
        ...this.currentStatus,
        installed: true,
        running: true,
        pid: this.currentStatus.pid || 4242,
      }
    })
  }

  uninstall(): void {
    this.run("uninstall", () => {
      this.currentStatus = { ...this.currentStatus, installed: false, running: false, pid: 0 }
    })
  }

  start(): void {
    this.run("start", () => {
      this.currentStatus = { ...this.currentStatus, running: true, pid: this.currentStatus.pid || 4242 }
    })
  }

  stop(): void {
    this.run("stop", () => {
      this.currentStatus = { ...this.currentStatus, running: false, pid: 0 }
    })
  }

  restart(): void {
    this.run("restart", () => {
      this.currentStatus = { ...this.currentStatus, running: true, pid: this.currentStatus.pid || 4242 }
    })
  }

  private run(operation: string, update: () => void): void {
    this.operations.push(operation)
    if (this.nextError) {
      const error = this.nextError
      this.nextError = null
      throw error
    }
    update()
  }
}

export const daemonServiceNames = {
  launchdLabel: LAUNCHD_LABEL,
  systemdServiceName: SYSTEMD_SERVICE_NAME,
}
