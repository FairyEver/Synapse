import { configStore } from "../services/config-store"
import { isDefaultAgentWorkspaceProjectId } from "../../src/lib/default-agent-workspace"
import { app, webContents } from "electron"
import path from "node:path"
import { AgentShareService } from "../../app-capabilities/agent/main/share-service"
import { createNativeShareOutput } from "../../app-capabilities/agent/main/share-native-output"
import { AGENT_SHARE_SERVICE_ID } from "../../app-capabilities/agent/shared/share"
import type { ServiceDescriptor } from "../runtime/service-registry"
import { ManagedAssetStore, type ConversationEntryV1, type DataRepository } from "../runtime/data-repo"
import type { ShareImageRecord } from "../runtime/data-repo/schemas/agent-share"
import type { GeneratedUiStateEntry } from "../runtime/data-repo/schemas/agent-generated-ui"
import type { EventBus } from "../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { GeneratedUiService } from "../services/agent-runtime/generated-ui-service"
import { createMainLogger } from "../services/log-store"

export const coreAgentShareDescriptor: ServiceDescriptor<AgentShareService> = {
  id: AGENT_SHARE_SERVICE_ID, criticality: "degraded",
  dependsOn: ["core.data-repository", "core.event-bus", "core.permission-guard", "core.audit-sink"],
  create(ctx) {
    const repo = ctx.registry.get<DataRepository>("core.data-repository"), bus = ctx.registry.get<EventBus>("core.event-bus")
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard"), auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const conversations = repo.namespace<ConversationEntryV1>("conversations"), logger = createMainLogger("agent.share")
    return new AgentShareService({ conversations, images: repo.namespace<ShareImageRecord>("app.agent.share-images"),
      assets: new ManagedAssetStore(path.join(app.getPath("userData"), "agent-share-images")),
      check: request => permissionGuard.check(request), audit: event => auditSink.record(event), logger,
      projectExists: async projectId => isDefaultAgentWorkspaceProjectId(projectId) || (await configStore.load()).global.projects.some(project => project.id === projectId),
      rendererAlive: id => { const renderer = webContents.fromId(id); return Boolean(renderer && !renderer.isDestroyed()) },
      emit: (request, rendererId) => bus.emit({ domain: "agent", type: "shareRender", payload: request, timestamp: new Date().toISOString(), scope: { rendererIds: [rendererId] } }, { backpressure: "block", orderingKey: `agent.share:${rendererId}` }),
      cancel: (requestId, rendererId) => bus.emit({ domain: "agent", type: "shareRenderCancelled", payload: { requestId }, timestamp: new Date().toISOString(), scope: { rendererIds: [rendererId] } }, { backpressure: "block", orderingKey: `agent.share:${rendererId}` }),
      changed: (projectId, conversationId) => bus.emit({ domain: "agent", type: "shareImagesChanged", payload: { projectId, conversationId }, timestamp: new Date().toISOString() }, { backpressure: "block" }),
      readUiState: target => new GeneratedUiService(target.projectId, conversations, repo.namespace<GeneratedUiStateEntry>("agent.generated-ui-state")).get(target),
      output: input => createNativeShareOutput({ permissionGuard, auditSink, logger }, input.rendererId).exportImage(input, { outputPath: input.outputPath, actor: input.actor, signal: input.signal }),
    })
  },
  stop: service => service.dispose(),
}
export const coreAgentShareMaintenanceDescriptor: ServiceDescriptor<{ service: AgentShareService }> = {
  id: "core.agent-share.maintenance", criticality: "degraded", startupPhase: "background", dependsOn: [AGENT_SHARE_SERVICE_ID],
  async create(ctx) { const service = ctx.registry.get<AgentShareService>(AGENT_SHARE_SERVICE_ID); await service.recover(); return { service } },
}
