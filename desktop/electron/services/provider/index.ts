import type {
  DataRepository,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { ProviderService } from "./provider-service"
import { PROVIDER_SERVICE_ID } from "./types"

export { PROVIDER_PRESETS } from "./provider-presets"
export { ProviderSecretStore, providerApiKeySecretId } from "./provider-secret-store"
export {
  ProviderService,
  type BuildProviderEnvContext,
  type ProviderServiceDeps,
} from "./provider-service"
export {
  LOCAL_CLAUDE_CODE_PROVIDER_ID,
  PROVIDER_SERVICE_ID,
  type CCProvider,
  type CreateProviderInput,
  type ProviderApiKeyField,
  type ProviderCategory,
  type UpdateProviderInput,
} from "./types"

export function createProviderProjectService(): ProjectScopedService<ProviderService> {
  return {
    id: PROVIDER_SERVICE_ID,
    create(ctx) {
      return createProviderServiceFromDataRepository({
        dataRepository: ctx.globalRegistry.get<DataRepository>("core.data-repository"),
        permissionGuard: ctx.globalRegistry.get<PermissionGuard>("core.permission-guard"),
        auditSink: ctx.globalRegistry.get<AuditSink>("core.audit-sink"),
      })
    },
  }
}

export function createProviderServiceFromDataRepository(deps: {
  readonly dataRepository: DataRepository
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}): ProviderService {
  return new ProviderService({
    providers: deps.dataRepository.namespace<ProviderEntryV1>("providers"),
    secrets: deps.dataRepository.namespace<SecretEntryV1>("secrets"),
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
  })
}
