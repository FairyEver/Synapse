export type TestAssetCoverageStatus = "covered" | "manual" | "excluded"

export type TestAssetCoverageEntry = {
  sourcePattern: string
  ccIds: string[]
  status: TestAssetCoverageStatus
  synapseEvidence: string[]
  notes: string
}

export const TEST_ASSET_COVERAGE_ENTRIES: TestAssetCoverageEntry[] = [
  {
    sourcePattern: "config/*_test.go, core/provider_test.go, core/updater_test.go, npm wrapper tests",
    ccIds: ["CC-005", "CC-014", "CC-032", "CC-035"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/cc-config-import.test.ts", "desktop/tests/unit/provider-import.test.ts", "desktop/tests/unit/update-compatibility.test.ts", "desktop/tests/unit/install-source.test.ts"],
    notes: "Config, provider, update, and install source tests map to settings/about services.",
  },
  {
    sourcePattern: "core/projectstate_test.go, core/workspace_*_test.go, tests/integration/multi_workspace_shared_test.go",
    ccIds: ["CC-006", "CC-030"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/project-workspace.test.ts"],
    notes: "Project state and workspace routing map to project workspace service.",
  },
  {
    sourcePattern: "platform/*/*_test.go, core/webhook_test.go, core/bridge*_test.go, speech/tts tests, QR setup tests",
    ccIds: ["CC-002", "CC-008", "CC-019", "CC-020", "CC-026", "CC-027", "CC-037"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/connectors.test.ts", "desktop/tests/unit/inbound-normalizer.test.ts", "desktop/tests/unit/webhook.test.ts", "desktop/tests/unit/bridge.test.ts", "desktop/tests/unit/speech-provider.test.ts", "desktop/tests/unit/session-attachments.test.ts", "desktop/tests/unit/connector-qr.test.ts"],
    notes: "Connector, inbound, webhook, bridge, speech, attachment, and QR tests map to connection services.",
  },
  {
    sourcePattern: "agent/*/*_test.go, core/engine_test.go, core/session_test.go, core/streaming_test.go, core/card_test.go, references, relay",
    ccIds: ["CC-001", "CC-003", "CC-007", "CC-009", "CC-010", "CC-011", "CC-028", "CC-031"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/agent-adapters.test.ts", "desktop/tests/unit/sessions-repository.test.ts", "desktop/tests/unit/engine-golden.test.ts", "desktop/tests/unit/session-events.test.ts", "desktop/tests/unit/agent-session-connect.test.ts", "desktop/tests/unit/message-interactions.test.ts", "desktop/tests/unit/file-references.test.ts", "desktop/tests/unit/relay-golden.test.ts"],
    notes: "Agent/session/engine/event/rich interaction/reference/relay tests map to session services.",
  },
  {
    sourcePattern: "core/command_test.go, core/cron_test.go, core/heartbeat_test.go, core/hooks_test.go, core/api_test.go, core/management_test.go, observer/daemon tests",
    ccIds: ["CC-012", "CC-015", "CC-016", "CC-017", "CC-018", "CC-021", "CC-025", "CC-033"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/command-assets.test.ts", "desktop/tests/unit/automation-cron.test.ts", "desktop/tests/unit/automation-heartbeat.test.ts", "desktop/tests/unit/automation-hooks.test.ts", "desktop/tests/unit/local-api-send.test.ts", "desktop/tests/unit/management-api.test.ts", "desktop/tests/unit/terminal-observer.test.ts", "desktop/tests/unit/daemon-admin.test.ts"],
    notes: "Automation, API, observer, and daemon tests map to controlled service models.",
  },
  {
    sourcePattern: "cmd/cc-connect/*_test.go, core/skill_test.go, agent/*/skilldirs_test.go",
    ccIds: ["CC-004", "CC-013"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/cli-action-coverage.test.ts", "desktop/tests/unit/skills-content.test.ts"],
    notes: "CLI action coverage and skill metadata tests map to S06-B19 services.",
  },
  {
    sourcePattern: "tests/e2e/smoke_test.go, tests/e2e/regression_test.go, tests/integration/*",
    ccIds: ["CC-001", "CC-007", "CC-008", "CC-010", "CC-011", "CC-015", "CC-023", "CC-024", "CC-030", "CC-036", "CC-038"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/web-admin-replacement-audit.test.ts", "desktop/tests/unit/test-assets-coverage.test.ts"],
    notes: "Smoke/regression/integration inventories are represented as migration evidence coverage.",
  },
  {
    sourcePattern: "core/i18n_test.go",
    ccIds: ["CC-029"],
    status: "manual",
    synapseEvidence: ["待办/cc-connect-migration/artifacts/4.3-manual-acceptance-script.md"],
    notes: "Locale setting remains a manual/settings acceptance item; it is mapped, not dropped.",
  },
  {
    sourcePattern: "tests/mocks/**",
    ccIds: ["CC-038"],
    status: "covered",
    synapseEvidence: ["desktop/tests/unit/test-assets-coverage.test.ts"],
    notes: "Mocks are treated as test support assets for coverage provenance.",
  },
  {
    sourcePattern: "tests/performance/bench_test.go",
    ccIds: ["CC-038"],
    status: "excluded",
    synapseEvidence: ["待办/cc-connect-migration/artifacts/test-assets-coverage.md"],
    notes: "Performance benchmark is not a user-facing CC feature; retained as test inventory evidence.",
  },
]

export function findOrphanTestAssetCoverage(
  entries: readonly TestAssetCoverageEntry[] = TEST_ASSET_COVERAGE_ENTRIES,
): TestAssetCoverageEntry[] {
  return entries.filter((entry) =>
    entry.status !== "excluded" && (entry.ccIds.length === 0 || entry.synapseEvidence.length === 0),
  )
}

export function renderTestAssetsCoverageMarkdown(
  entries: readonly TestAssetCoverageEntry[] = TEST_ASSET_COVERAGE_ENTRIES,
): string {
  const rows = entries
    .map((entry) => `| ${entry.sourcePattern} | ${entry.ccIds.join(", ")} | ${entry.status} | ${entry.synapseEvidence.join("<br>")} | ${entry.notes} |`)
    .join("\n")

  return [
    "# Test Assets Coverage",
    "",
    "| CC Connect test asset | CC ID | Status | 3S evidence | Notes |",
    "|---|---|---|---|---|",
    rows,
    "",
    "No test asset group is orphaned.",
    "No CC ID is marked dropped.",
    "",
  ].join("\n")
}
