import type {
  DataRepository,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../runtime/data-repo"
import type { ProjectScopedService } from "../../runtime/project-container"
import { ProviderService } from "./provider-service"
import { PROVIDER_SERVICE_ID } from "./types"

export { PROVIDER_PRESETS } from "./provider-presets"
export { ProviderSecretStore, providerApiKeySecretId } from "./provider-secret-store"
export { ProviderService, type ProviderServiceDeps } from "./provider-service"
export {
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
      })
    },
  }
}

export function createProviderServiceFromDataRepository(deps: {
  readonly dataRepository: DataRepository
}): ProviderService {
  return new ProviderService({
    providers: deps.dataRepository.namespace<ProviderEntryV1>("providers"),
    secrets: deps.dataRepository.namespace<SecretEntryV1>("secrets"),
  })
}
