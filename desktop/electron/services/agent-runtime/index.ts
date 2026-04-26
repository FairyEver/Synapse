import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import {
  createControlledProcessRunner,
} from "../../runtime/process"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { CodexExecAdapter } from "./adapters/codex-exec"
import { AgentRuntimeService } from "./agent-runtime-service"
import { AGENT_RUNTIME_SERVICE_ID } from "./types"

export {
  AgentRuntimeService,
  conversationId,
  type AgentRuntimeServiceDeps,
} from "./agent-runtime-service"
export {
  CodexExecAdapter,
  CodexJsonLineParser,
  buildCodexExecArgs,
  parseCodexJsonLines,
  type CodexExecArgsOptions,
  type CodexExecOptions,
  type CodexParseResult,
  type CodexProcessRunner,
} from "./adapters/codex-exec"
export {
  AGENT_RUNTIME_SERVICE_ID,
  type AgentAdapter,
  type AgentAttachment,
  type AgentEvent,
  type AgentExecutionContext,
  type AgentExecutionResult,
  type AgentMessage,
  type AgentRuntimeTurnResult,
} from "./types"

export function createAgentRuntimeProjectService(): ProjectScopedService<AgentRuntimeService> {
  return {
    id: AGENT_RUNTIME_SERVICE_ID,
    create(ctx) {
      const permissionGuard = ctx.globalRegistry.get<PermissionGuard>("core.permission-guard")
      const auditSink = ctx.globalRegistry.get<AuditSink>("core.audit-sink")
      const runner = createControlledProcessRunner({ permissionGuard, auditSink })
      return new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        adapter: new CodexExecAdapter(runner),
        eventBus: ctx.eventBus,
        logger: ctx.logger,
      })
    },
  }
}
