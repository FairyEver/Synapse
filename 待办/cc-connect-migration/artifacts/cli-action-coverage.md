# CLI Action Coverage

| CC Connect command/flag | Status | 3S target | Evidence | Notes |
|---|---|---|---|---|
| config-example | covered | legacy config import preview | `desktop/tests/unit/cc-config-import.test.ts` | Config template semantics are represented by import/default handling. |
| config | merged | settings config services | `desktop/tests/unit/cc-config-import.test.ts`<br>`desktop/tests/unit/project-workspace.test.ts` | Config read/write behavior is split into typed settings services. |
| update | replaced | 3S update service | `desktop/tests/unit/update-compatibility.test.ts` | Old binary self-update is replaced by app update compatibility status. |
| check-update | replaced | 3S update service | `desktop/tests/unit/update-compatibility.test.ts` | Check-only flow maps to update status. |
| provider | covered | provider model service | `desktop/tests/unit/provider-import.test.ts` | Provider add/list/import/remove semantics are covered by provider refs and secretRef drafts. |
| send | covered | local API send handler | `desktop/tests/unit/local-api-send.test.ts` | Message and attachment-only send map to the local API service. |
| cron | covered | automation cron scheduler | `desktop/tests/unit/automation-cron.test.ts` | Cron add/list/edit/delete and execution plan semantics map to automation tasks. |
| relay | covered | relay service | `desktop/tests/unit/relay-golden.test.ts` | Cross-project message relay maps to the session relay service. |
| sessions | covered | sessions repository | `desktop/tests/unit/sessions-repository.test.ts` | Session list/show/lifecycle semantics map to the repository service. |
| agent-sid | covered | sessions repository agent session mapping | `desktop/tests/unit/sessions-repository.test.ts` | Agent session IDs are kept on session records instead of a standalone command. |
| daemon | covered | daemon admin service | `desktop/tests/unit/daemon-admin.test.ts` | Lifecycle status and guarded mock operations map to daemon admin. |
| feishu | covered | connector QR onboarding | `desktop/tests/unit/connector-qr.test.ts` | Feishu/Lark setup and bind flows map to QR onboarding. |
| weixin | covered | connector QR onboarding | `desktop/tests/unit/connector-qr.test.ts` | Weixin bind/scan/confirm flows map to QR onboarding. |
| doctor | covered | security doctor service | `desktop/tests/unit/security-doctor.test.ts` | run_as_user doctor maps to security reports. |
| web | replaced | 3S app shell modules | `desktop/tests/unit/cli-action-coverage.test.ts` | Old Web Admin is replaced by mapped modules; no old SPA page is added. |
| --config | merged | config import and settings services | `desktop/tests/unit/cc-config-import.test.ts` | Explicit config path maps to import/source selection. |
| --force | merged | safe explicit operation controls | `desktop/tests/unit/daemon-admin.test.ts` | Force semantics are represented only on guarded operations such as daemon reinstall. |
| --version | covered | install source metadata | `desktop/tests/unit/install-source.test.ts` | Version and source are surfaced through install metadata. |
| --observe | covered | terminal observer service | `desktop/tests/unit/terminal-observer.test.ts` | Observation parsing is covered; real file observation stays behind explicit permission. |
| --observe-channel | covered | terminal observer destination binding | `desktop/tests/unit/terminal-observer.test.ts` | Destination binding is represented as typed observer configuration. |

No CC command is marked dropped.
