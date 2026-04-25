export type SecurityDoctorSeverity = "pass" | "warn" | "fatal"

export type SecurityDoctorCheck = {
  id: string
  severity: SecurityDoctorSeverity
  message: string
  detail?: string
}

export type RunAsPreflightInput = {
  project: string
  runAsUser: string
  workDir?: string
  platform?: NodeJS.Platform
  sudoToTarget: "ok" | "error"
  sudoToTargetError?: string
  targetCanEscalate?: boolean
  sudoListOutput?: string
  workDirAccess?: {
    readable: boolean
    writable: boolean
  }
  descendantFindings?: string[]
  descendantScanTimedOut?: boolean
  maxDescendantReport?: number
}

export type SecurityDoctorReport = {
  project: string
  runAsUser: string
  generatedAt: string
  checks: SecurityDoctorCheck[]
}

export type RunAsIdentitySnapshot = {
  id?: string
  whoami?: string
  groups?: string
  umask?: string
  pwd?: string
  home?: string
  shell?: string
}

export type RunAsWorkDirStatus = {
  path?: string
  exists?: boolean
  readable?: boolean
  writable?: boolean
}

export type RunAsPathStatus = {
  path: string
  status: "has" | "missing" | "denied" | "leaked"
}

export type RunAsCrossUserResult = {
  otherUser: string
  path: string
  status: "missing" | "denied" | "leaked" | "unknown-user"
}

export type RunAsIsolationReport = {
  project: string
  runAsUser: string
  workDir: string
  probeVersion?: string
  identity: RunAsIdentitySnapshot
  workDirStatus: RunAsWorkDirStatus
  targetPaths: RunAsPathStatus[]
  crossUser: RunAsCrossUserResult[]
  supervisor: RunAsPathStatus[]
  fatal: string[]
  rawOutput?: string
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

export function redactPathLikeText(text: string): string {
  return text
    .replace(/\/Users\/[^/\s:]+/g, "/Users/[USER]")
    .replace(/\/home\/[^/\s:]+/g, "/home/[USER]")
}

function maybeRedact(value: string, redact: boolean): string {
  return redact ? redactPathLikeText(value) : value
}

export function createRunAsPreflightReport(
  input: RunAsPreflightInput,
  options: { now?: () => Date } = {},
): SecurityDoctorReport {
  const checks: SecurityDoctorCheck[] = []
  const project = input.project.trim() || "(unnamed project)"
  const runAsUser = input.runAsUser.trim()
  const platform = input.platform ?? process.platform

  if (platform === "win32") {
    checks.push({
      id: "run-as-supported-os",
      severity: "fatal",
      message: "run_as_user is not supported on Windows",
    })
    return {
      project,
      runAsUser,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      checks,
    }
  }

  if (!runAsUser) {
    checks.push({
      id: "run-as-user-present",
      severity: "fatal",
      message: "run_as_user is empty",
    })
    return {
      project,
      runAsUser,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      checks,
    }
  }

  if (input.sudoToTarget === "error") {
    checks.push({
      id: "sudo-to-target",
      severity: "fatal",
      message: `passwordless sudo to user ${JSON.stringify(runAsUser)} is not configured`,
      ...(input.sudoToTargetError ? { detail: input.sudoToTargetError } : undefined),
    })
    return {
      project,
      runAsUser,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      checks,
    }
  }

  checks.push({
    id: "sudo-to-target",
    severity: "pass",
    message: "passwordless sudo to target user is configured",
  })

  if (input.targetCanEscalate) {
    checks.push({
      id: "target-passwordless-sudo",
      severity: "fatal",
      message: `target user ${JSON.stringify(runAsUser)} can run passwordless sudo`,
      ...(input.sudoListOutput ? { detail: input.sudoListOutput.trim() } : undefined),
    })
  } else {
    checks.push({
      id: "target-passwordless-sudo",
      severity: "pass",
      message: "target user cannot escalate with passwordless sudo",
    })
  }

  if (!input.workDir?.trim()) {
    checks.push({
      id: "workdir-root-access",
      severity: "warn",
      message: "no work_dir configured; filesystem access checks skipped",
    })
  } else if (!input.workDirAccess?.readable || !input.workDirAccess.writable) {
    checks.push({
      id: "workdir-root-access",
      severity: "fatal",
      message: `target user ${JSON.stringify(runAsUser)} cannot read AND write work_dir`,
      detail: input.workDir,
    })
  } else {
    checks.push({
      id: "workdir-root-access",
      severity: "pass",
      message: "target user can read and write work_dir",
      detail: input.workDir,
    })
  }

  if (input.descendantScanTimedOut) {
    checks.push({
      id: "workdir-descendant-scan",
      severity: "warn",
      message: "work_dir descendant scan timed out",
    })
  } else {
    const findings = uniqueSorted(input.descendantFindings ?? [])
    const maxReport = input.maxDescendantReport ?? 50
    if (findings.length > 0) {
      const shown = findings.slice(0, maxReport)
      const extra = findings.length - shown.length
      checks.push({
        id: "workdir-descendant-scan",
        severity: "warn",
        message: "work_dir contains paths the target user may not access cleanly",
        detail: extra > 0
          ? `${shown.join("\n")}\n... and ${extra} more`
          : shown.join("\n"),
      })
    } else if (input.workDir?.trim() && input.workDirAccess?.readable && input.workDirAccess.writable) {
      checks.push({
        id: "workdir-descendant-scan",
        severity: "pass",
        message: "no descendant access warnings",
      })
    }
  }

  return {
    project,
    runAsUser,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    checks,
  }
}

function splitTag(line: string): [string, string] {
  const separatorIndex = line.indexOf(" ")
  return separatorIndex < 0
    ? [line, ""]
    : [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)]
}

export function parseIsolationProbeOutput(
  output: string,
  input: { project: string; runAsUser: string; workDir: string },
): RunAsIsolationReport {
  const report: RunAsIsolationReport = {
    project: input.project,
    runAsUser: input.runAsUser,
    workDir: input.workDir,
    identity: {},
    workDirStatus: {},
    targetPaths: [],
    crossUser: [],
    supervisor: [],
    fatal: [],
  }

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const [tag, rest] = splitTag(line)
    switch (tag) {
      case "BEGIN":
        if (rest.startsWith("probe-version=")) {
          report.probeVersion = rest.slice("probe-version=".length)
        }
        break
      case "ID":
        report.identity.id = rest
        break
      case "WHOAMI":
        report.identity.whoami = rest
        break
      case "GROUPS":
        report.identity.groups = rest
        break
      case "UMASK":
        report.identity.umask = rest
        break
      case "PWD":
        report.identity.pwd = rest
        break
      case "HOME":
        report.identity.home = rest
        break
      case "SHELL":
        report.identity.shell = rest
        break
      case "WORKDIR_PATH":
        report.workDirStatus.path = rest
        break
      case "WORKDIR_EXISTS":
        report.workDirStatus.exists = rest === "yes"
        break
      case "WORKDIR_READABLE":
        report.workDirStatus.readable = rest === "yes"
        break
      case "WORKDIR_WRITABLE":
        report.workDirStatus.writable = rest === "yes"
        break
      case "TARGET_HAS":
        report.targetPaths.push({ path: rest, status: "has" })
        break
      case "TARGET_MISSING":
        report.targetPaths.push({ path: rest, status: "missing" })
        break
      case "CROSS_DENIED":
      case "CROSS_LEAKED":
      case "CROSS_MISSING": {
        const [otherUser, targetPath] = splitTag(rest)
        report.crossUser.push({
          otherUser,
          path: targetPath,
          status: tag.slice("CROSS_".length).toLowerCase() as "missing" | "denied" | "leaked",
        })
        break
      }
      case "CROSS_UNKNOWN":
        report.crossUser.push({ otherUser: rest, path: "", status: "unknown-user" })
        break
      case "SUPERVISOR_DENIED":
        report.supervisor.push({ path: rest, status: "denied" })
        break
      case "SUPERVISOR_LEAKED":
        report.supervisor.push({ path: rest, status: "leaked" })
        break
      case "SUPERVISOR_MISSING":
        report.supervisor.push({ path: rest, status: "missing" })
        break
    }
  }

  report.fatal = computeIsolationFatal(report)
  if (report.fatal.length > 0) {
    report.rawOutput = output
  }

  return report
}

export function computeIsolationFatal(report: RunAsIsolationReport): string[] {
  const fatal: string[] = []

  for (const item of report.crossUser) {
    if (item.status === "leaked") {
      fatal.push(`project ${JSON.stringify(report.project)}: target user ${JSON.stringify(report.runAsUser)} can read ${JSON.stringify(item.path)} belonging to user ${JSON.stringify(item.otherUser)} (CROSS_LEAKED)`)
    }
  }

  for (const item of report.supervisor) {
    if (item.status === "leaked") {
      fatal.push(`project ${JSON.stringify(report.project)}: target user ${JSON.stringify(report.runAsUser)} can read supervisor path ${JSON.stringify(item.path)} (SUPERVISOR_LEAKED)`)
    }
  }

  if (report.workDirStatus.path && report.workDirStatus.writable === false) {
    fatal.push(`project ${JSON.stringify(report.project)}: target user ${JSON.stringify(report.runAsUser)} cannot write work_dir ${JSON.stringify(report.workDirStatus.path)} (WORKDIR_WRITABLE=no)`)
  }

  return fatal
}

export function renderIsolationHumanReport(
  report: RunAsIsolationReport,
  options: { redact?: boolean } = {},
): string {
  const redact = options.redact ?? true
  const targetPresent = report.targetPaths.filter((item) => item.status === "has").length
  const targetMissing = report.targetPaths.filter((item) => item.status === "missing").length
  const crossDenied = report.crossUser.filter((item) => item.status === "denied").length
  const crossLeaked = report.crossUser.filter((item) => item.status === "leaked").length
  const supervisorDenied = report.supervisor.filter((item) => item.status === "denied").length
  const supervisorLeaked = report.supervisor.filter((item) => item.status === "leaked").length
  const lines = [
    `whoami         : ${report.identity.whoami ?? ""}`,
    `id             : ${report.identity.id ?? ""}`,
    `home           : ${maybeRedact(report.identity.home ?? "", redact)}`,
    `workdir        : ${maybeRedact(report.workDirStatus.path ?? "", redact)} (readable=${report.workDirStatus.readable === true} writable=${report.workDirStatus.writable === true})`,
    `target home    : ${targetPresent} present, ${targetMissing} missing`,
  ]

  for (const item of report.targetPaths) {
    if (item.status === "missing") {
      lines.push(`  missing: ${maybeRedact(item.path, redact)}`)
    }
  }

  lines.push(`cross-user     : ${crossDenied} denied, ${crossLeaked} leaked`)
  for (const item of report.crossUser) {
    if (item.status === "leaked") {
      lines.push(`  LEAKED: ${report.runAsUser} can read ${maybeRedact(item.path, redact)} (${item.otherUser})`)
    }
  }

  lines.push(`supervisor     : ${supervisorDenied} denied, ${supervisorLeaked} leaked`)
  for (const item of report.supervisor) {
    if (item.status === "leaked") {
      lines.push(`  LEAKED: ${report.runAsUser} can read supervisor's ${maybeRedact(item.path, redact)}`)
    }
  }

  if (report.fatal.length > 0) {
    lines.push("audit          : FATAL")
    lines.push(...report.fatal.map((item) => `  ${maybeRedact(item, redact)}`))
  } else {
    lines.push("audit          : OK")
  }

  return lines.join("\n")
}
