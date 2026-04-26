import type {
  DataRepository,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { ProviderConfigService } from "./provider-config-service"
import { PROVIDER_CONFIG_SERVICE_ID } from "./types"

export {
  prepareCodexRuntime,
  buildCodexProviderSection,
  upsertCodexProviderSection,
} from "./codex-runtime"
export {
  ProviderConfigService,
  projectProviderEntryId,
  projectStateEntryId,
  type ProviderConfigServiceDeps,
} from "./provider-config-service"
export {
  PROVIDER_CONFIG_SERVICE_ID,
  type AgentRuntimeAgentType,
  type ProjectProviderState,
  type ProviderConfigInput,
  type ProviderConfigView,
  type ProviderRuntimeRequest,
  type ProviderRuntimeView,
} from "./types"

export function createProviderConfigProjectService(): ProjectScopedService<ProviderConfigService> {
  return {
    id: PROVIDER_CONFIG_SERVICE_ID,
    create(ctx) {
      return createProviderConfigServiceFromDataRepository({
        dataRepository: ctx.globalRegistry.get<DataRepository>("core.data-repository"),
        permissionGuard: ctx.globalRegistry.get<PermissionGuard>("core.permission-guard"),
        auditSink: ctx.globalRegistry.get<AuditSink>("core.audit-sink"),
      })
    },
  }
}

export function createProviderConfigServiceFromDataRepository(deps: {
  readonly dataRepository: DataRepository
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}): ProviderConfigService {
  return new ProviderConfigService({
    providers: deps.dataRepository.namespace<ProviderEntryV1>("providers"),
    secrets: deps.dataRepository.namespace<SecretEntryV1>("secrets"),
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
  })
}
