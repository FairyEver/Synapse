export {
  DataRepositoryAuditSink,
  type DataRepositoryAuditSinkDeps,
} from "./audit-sink"
export {
  InMemoryAuditSink,
  PermissionGuardImpl,
  createPermissionGuard,
  TERMINAL_CWD_PROBE_ACTOR_ID,
  userInitiatedAllowPolicy,
  systemShellExecPolicy,
  systemTerminalCwdProbePolicy,
  webhookShellExecPolicy,
  systemAutomationPolicy,
  systemMcpAutoRegisterPolicy,
  systemDataMaintenancePolicy,
} from "./permission-guard"
export type {
  ActorIdentity,
  AuditEvent,
  AuditSink,
  PermissionAction,
  PermissionDecision,
  PermissionGuard,
  PermissionPolicy,
  PermissionRequest,
  PermissionResult,
} from "./permission-guard"
