export type CliActionCoverageStatus = "covered" | "merged" | "replaced"

export type CliActionCoverageEntry = {
  command: string
  status: CliActionCoverageStatus
  target: string
  evidence: string[]
  notes: string
}

export const CC_CONNECT_CLI_COMMANDS = [
  "config-example",
  "config",
  "update",
  "check-update",
  "provider",
  "send",
  "cron",
  "relay",
  "sessions",
  "agent-sid",
  "daemon",
  "feishu",
  "weixin",
  "doctor",
  "web",
  "--config",
  "--force",
  "--version",
  "--observe",
  "--observe-channel",
] as const

export type CcConnectCliCommand = typeof CC_CONNECT_CLI_COMMANDS[number]

export const DEFAULT_CLI_ACTION_COVERAGE: CliActionCoverageEntry[] = [
  {
    command: "config-example",
    status: "covered",
    target: "legacy config import preview",
    evidence: ["desktop/tests/unit/cc-config-import.test.ts"],
    notes: "Config template semantics are represented by import/default handling.",
  },
  {
    command: "config",
    status: "merged",
    target: "settings config services",
    evidence: ["desktop/tests/unit/cc-config-import.test.ts", "desktop/tests/unit/project-workspace.test.ts"],
    notes: "Config read/write behavior is split into typed settings services.",
  },
  {
    command: "update",
    status: "replaced",
    target: "3S update service",
    evidence: ["desktop/tests/unit/update-compatibility.test.ts"],
    notes: "Old binary self-update is replaced by app update compatibility status.",
  },
  {
    command: "check-update",
    status: "replaced",
    target: "3S update service",
    evidence: ["desktop/tests/unit/update-compatibility.test.ts"],
    notes: "Check-only flow maps to update status.",
  },
  {
    command: "provider",
    status: "covered",
    target: "provider model service",
    evidence: ["desktop/tests/unit/provider-import.test.ts"],
    notes: "Provider add/list/import/remove semantics are covered by provider refs and secretRef drafts.",
  },
  {
    command: "send",
    status: "covered",
    target: "local API send handler",
    evidence: ["desktop/tests/unit/local-api-send.test.ts"],
    notes: "Message and attachment-only send map to the local API service.",
  },
  {
    command: "cron",
    status: "covered",
    target: "automation cron scheduler",
    evidence: ["desktop/tests/unit/automation-cron.test.ts"],
    notes: "Cron add/list/edit/delete and execution plan semantics map to automation tasks.",
  },
  {
    command: "relay",
    status: "covered",
    target: "relay service",
    evidence: ["desktop/tests/unit/relay-golden.test.ts"],
    notes: "Cross-project message relay maps to the session relay service.",
  },
  {
    command: "sessions",
    status: "covered",
    target: "sessions repository",
    evidence: ["desktop/tests/unit/sessions-repository.test.ts"],
    notes: "Session list/show/lifecycle semantics map to the repository service.",
  },
  {
    command: "agent-sid",
    status: "covered",
    target: "sessions repository agent session mapping",
    evidence: ["desktop/tests/unit/sessions-repository.test.ts"],
    notes: "Agent session IDs are kept on session records instead of a standalone command.",
  },
  {
    command: "daemon",
    status: "covered",
    target: "daemon admin service",
    evidence: ["desktop/tests/unit/daemon-admin.test.ts"],
    notes: "Lifecycle status and guarded mock operations map to daemon admin.",
  },
  {
    command: "feishu",
    status: "covered",
    target: "connector QR onboarding",
    evidence: ["desktop/tests/unit/connector-qr.test.ts"],
    notes: "Feishu/Lark setup and bind flows map to QR onboarding.",
  },
  {
    command: "weixin",
    status: "covered",
    target: "connector QR onboarding",
    evidence: ["desktop/tests/unit/connector-qr.test.ts"],
    notes: "Weixin bind/scan/confirm flows map to QR onboarding.",
  },
  {
    command: "doctor",
    status: "covered",
    target: "security doctor service",
    evidence: ["desktop/tests/unit/security-doctor.test.ts"],
    notes: "run_as_user doctor maps to security reports.",
  },
  {
    command: "web",
    status: "replaced",
    target: "3S app shell modules",
    evidence: ["desktop/tests/unit/cli-action-coverage.test.ts"],
    notes: "Old Web Admin is replaced by mapped modules; no old SPA page is added.",
  },
  {
    command: "--config",
    status: "merged",
    target: "config import and settings services",
    evidence: ["desktop/tests/unit/cc-config-import.test.ts"],
    notes: "Explicit config path maps to import/source selection.",
  },
  {
    command: "--force",
    status: "merged",
    target: "safe explicit operation controls",
    evidence: ["desktop/tests/unit/daemon-admin.test.ts"],
    notes: "Force semantics are represented only on guarded operations such as daemon reinstall.",
  },
  {
    command: "--version",
    status: "covered",
    target: "install source metadata",
    evidence: ["desktop/tests/unit/install-source.test.ts"],
    notes: "Version and source are surfaced through install metadata.",
  },
  {
    command: "--observe",
    status: "covered",
    target: "terminal observer service",
    evidence: ["desktop/tests/unit/terminal-observer.test.ts"],
    notes: "Observation parsing is covered; real file observation stays behind explicit permission.",
  },
  {
    command: "--observe-channel",
    status: "covered",
    target: "terminal observer destination binding",
    evidence: ["desktop/tests/unit/terminal-observer.test.ts"],
    notes: "Destination binding is represented as typed observer configuration.",
  },
]

export function findMissingCliActions(
  required: readonly string[] = CC_CONNECT_CLI_COMMANDS,
  coverage: readonly CliActionCoverageEntry[] = DEFAULT_CLI_ACTION_COVERAGE,
): string[] {
  const covered = new Set(coverage.map((entry) => entry.command))
  return required.filter((command) => !covered.has(command))
}

export function renderCliActionCoverageMarkdown(
  coverage: readonly CliActionCoverageEntry[] = DEFAULT_CLI_ACTION_COVERAGE,
): string {
  const rows = coverage
    .map((entry) => [
      entry.command,
      entry.status,
      entry.target,
      entry.evidence.join("<br>"),
      entry.notes,
    ])
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n")

  return [
    "# CLI Action Coverage",
    "",
    "| CC Connect command/flag | Status | 3S target | Evidence | Notes |",
    "|---|---|---|---|---|",
    rows,
    "",
    "No CC command is marked dropped.",
    "",
  ].join("\n")
}
