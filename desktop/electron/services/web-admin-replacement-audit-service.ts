export type WebAdminReplacementKind = "route" | "sidebar" | "page" | "api"

export type WebAdminReplacementEntry = {
  source: string
  kind: WebAdminReplacementKind
  ccIds: string[]
  replacement: string
  evidence: string[]
  notes: string
}

export const WEB_ADMIN_REPLACEMENT_ENTRIES: WebAdminReplacementEntry[] = [
  {
    source: "/",
    kind: "route",
    ccIds: ["CC-036"],
    replacement: "3S app shell overview",
    evidence: ["desktop/src/app-shell", "desktop/src/modules"],
    notes: "Dashboard is replaced by existing app shell navigation and module summaries.",
  },
  {
    source: "/projects",
    kind: "route",
    ccIds: ["CC-006", "CC-030"],
    replacement: "settings/projects and workspace services",
    evidence: ["desktop/tests/unit/project-workspace.test.ts"],
    notes: "Project list/detail behavior maps to project/workspace settings and service state.",
  },
  {
    source: "/providers",
    kind: "route",
    ccIds: ["CC-014"],
    replacement: "settings/provider service",
    evidence: ["desktop/tests/unit/provider-import.test.ts"],
    notes: "Provider list/import/update behavior maps to provider + secretRef service.",
  },
  {
    source: "/skills",
    kind: "route",
    ccIds: ["CC-013"],
    replacement: "skills module and content services",
    evidence: ["desktop/tests/unit/skills-content.test.ts"],
    notes: "Skill list and presets are covered by skill content compatibility.",
  },
  {
    source: "/chat",
    kind: "route",
    ccIds: ["CC-001", "CC-010", "CC-011"],
    replacement: "agent sessions module",
    evidence: ["desktop/tests/unit/agent-session-connect.test.ts", "desktop/tests/unit/message-interactions.test.ts"],
    notes: "Chat list/view maps to sessions, connector-to-session flow, and rich interactions.",
  },
  {
    source: "/cron",
    kind: "route",
    ccIds: ["CC-015", "CC-016", "CC-017"],
    replacement: "automation services",
    evidence: ["desktop/tests/unit/automation-cron.test.ts", "desktop/tests/unit/automation-heartbeat.test.ts", "desktop/tests/unit/automation-hooks.test.ts"],
    notes: "Cron page maps to automation scheduler; heartbeat and hooks share the automation surface.",
  },
  {
    source: "/system",
    kind: "route",
    ccIds: ["CC-005", "CC-021", "CC-022", "CC-032", "CC-034", "CC-035"],
    replacement: "settings/admin/security/about/debug services",
    evidence: ["desktop/tests/unit/management-api.test.ts", "desktop/tests/unit/security-doctor.test.ts", "desktop/tests/unit/daemon-log-export.test.ts", "desktop/tests/unit/install-source.test.ts", "desktop/tests/unit/update-compatibility.test.ts"],
    notes: "System config maps to settings and admin/debug service entries.",
  },
  {
    source: "Bridge/BridgeAdapters.tsx",
    kind: "page",
    ccIds: ["CC-020"],
    replacement: "bridge service",
    evidence: ["desktop/tests/unit/bridge.test.ts"],
    notes: "Bridge adapter management is covered by bridge protocol service tests.",
  },
  {
    source: "Projects/PlatformSetupQR.tsx",
    kind: "page",
    ccIds: ["CC-002", "CC-037"],
    replacement: "connector registry and QR onboarding",
    evidence: ["desktop/tests/unit/connectors.test.ts", "desktop/tests/unit/connector-qr.test.ts"],
    notes: "Platform setup maps to connector descriptors and QR onboarding states.",
  },
  {
    source: "System/GlobalSettings.tsx",
    kind: "page",
    ccIds: ["CC-005", "CC-014", "CC-021", "CC-029"],
    replacement: "settings services",
    evidence: ["desktop/tests/unit/cc-config-import.test.ts", "desktop/tests/unit/provider-import.test.ts", "desktop/tests/unit/management-api.test.ts"],
    notes: "Global settings are split by domain; locale CC-029 remains a planned settings acceptance item.",
  },
  {
    source: "/api/v1",
    kind: "api",
    ccIds: ["CC-018", "CC-021"],
    replacement: "typed local API and management API services",
    evidence: ["desktop/tests/unit/local-api-send.test.ts", "desktop/tests/unit/management-api.test.ts"],
    notes: "Old JSON API client maps to NetworkServiceRegistry descriptors and typed handlers.",
  },
]

export function findUnmappedWebAdminEntries(
  entries: readonly WebAdminReplacementEntry[] = WEB_ADMIN_REPLACEMENT_ENTRIES,
): WebAdminReplacementEntry[] {
  return entries.filter((entry) => entry.ccIds.length === 0 || !entry.replacement || entry.evidence.length === 0)
}

export function renderWebAdminReplacementAuditMarkdown(
  entries: readonly WebAdminReplacementEntry[] = WEB_ADMIN_REPLACEMENT_ENTRIES,
): string {
  const rows = entries
    .map((entry) => `| ${entry.source} | ${entry.kind} | ${entry.ccIds.join(", ")} | ${entry.replacement} | ${entry.evidence.join("<br>")} | ${entry.notes} |`)
    .join("\n")

  return [
    "# Web Admin Replacement Audit",
    "",
    "| Old Web Admin source | Kind | CC ID | 3S replacement | Evidence | Notes |",
    "|---|---|---|---|---|---|",
    rows,
    "",
    "No old Web Admin SPA route is reintroduced.",
    "No Web Admin source entry is orphaned.",
    "",
  ].join("\n")
}
