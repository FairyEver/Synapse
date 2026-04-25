# Web Admin Replacement Audit

| Old Web Admin source | Kind | CC ID | 3S replacement | Evidence | Notes |
|---|---|---|---|---|---|
| `/` | route | CC-036 | 3S app shell overview | `desktop/src/app-shell`<br>`desktop/src/modules` | Dashboard is replaced by existing app shell navigation and module summaries. |
| `/projects` | route | CC-006, CC-030 | settings/projects and workspace services | `desktop/tests/unit/project-workspace.test.ts` | Project list/detail behavior maps to project/workspace settings and service state. |
| `/providers` | route | CC-014 | settings/provider service | `desktop/tests/unit/provider-import.test.ts` | Provider list/import/update behavior maps to provider + secretRef service. |
| `/skills` | route | CC-013 | skills module and content services | `desktop/tests/unit/skills-content.test.ts` | Skill list and presets are covered by skill content compatibility. |
| `/chat` | route | CC-001, CC-010, CC-011 | agent sessions module | `desktop/tests/unit/agent-session-connect.test.ts`<br>`desktop/tests/unit/message-interactions.test.ts` | Chat list/view maps to sessions, connector-to-session flow, and rich interactions. |
| `/cron` | route | CC-015, CC-016, CC-017 | automation services | `desktop/tests/unit/automation-cron.test.ts`<br>`desktop/tests/unit/automation-heartbeat.test.ts`<br>`desktop/tests/unit/automation-hooks.test.ts` | Cron page maps to automation scheduler; heartbeat and hooks share the automation surface. |
| `/system` | route | CC-005, CC-021, CC-022, CC-032, CC-034, CC-035 | settings/admin/security/about/debug services | `desktop/tests/unit/management-api.test.ts`<br>`desktop/tests/unit/security-doctor.test.ts`<br>`desktop/tests/unit/daemon-log-export.test.ts`<br>`desktop/tests/unit/install-source.test.ts`<br>`desktop/tests/unit/update-compatibility.test.ts` | System config maps to settings and admin/debug service entries. |
| `Bridge/BridgeAdapters.tsx` | page | CC-020 | bridge service | `desktop/tests/unit/bridge.test.ts` | Bridge adapter management is covered by bridge protocol service tests. |
| `Projects/PlatformSetupQR.tsx` | page | CC-002, CC-037 | connector registry and QR onboarding | `desktop/tests/unit/connectors.test.ts`<br>`desktop/tests/unit/connector-qr.test.ts` | Platform setup maps to connector descriptors and QR onboarding states. |
| `System/GlobalSettings.tsx` | page | CC-005, CC-014, CC-021, CC-029 | settings services | `desktop/tests/unit/cc-config-import.test.ts`<br>`desktop/tests/unit/provider-import.test.ts`<br>`desktop/tests/unit/management-api.test.ts` | Global settings are split by domain; locale CC-029 remains a planned settings acceptance item. |
| `/api/v1` | api | CC-018, CC-021 | typed local API and management API services | `desktop/tests/unit/local-api-send.test.ts`<br>`desktop/tests/unit/management-api.test.ts` | Old JSON API client maps to NetworkServiceRegistry descriptors and typed handlers. |

No old Web Admin SPA route is reintroduced.
No Web Admin source entry is orphaned.
