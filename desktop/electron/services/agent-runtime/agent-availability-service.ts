export interface AgentAvailability {
  readonly agentType: string
  readonly label: string
  readonly available: boolean
  readonly binaryPath?: string
}

interface AgentDefinitionInput {
  readonly id: string
  readonly label: string
  readonly runtime: { readonly kind: string; readonly binaries: readonly string[] }
}

export interface AgentAvailabilityServiceDeps {
  readonly whichBin: (bin: string) => Promise<string | null>
  readonly definitions: readonly AgentDefinitionInput[]
}

export class AgentAvailabilityService {
  private readonly deps: AgentAvailabilityServiceDeps
  private cache: AgentAvailability[] | null = null

  constructor(deps: AgentAvailabilityServiceDeps) {
    this.deps = deps
  }

  async detectAll(): Promise<readonly AgentAvailability[]> {
    if (this.cache) return this.cache
    this.cache = await this.detect()
    return this.cache
  }

  async refresh(): Promise<readonly AgentAvailability[]> {
    this.cache = null
    return this.detectAll()
  }

  private async detect(): Promise<AgentAvailability[]> {
    const results: AgentAvailability[] = []
    for (const def of this.deps.definitions) {
      if (def.runtime.kind !== "local-cli") {
        results.push({ agentType: def.id, label: def.label, available: true })
        continue
      }
      let binaryPath: string | undefined
      for (const bin of def.runtime.binaries) {
        const path = await this.deps.whichBin(bin)
        if (path) { binaryPath = path; break }
      }
      results.push({
        agentType: def.id,
        label: def.label,
        available: binaryPath !== undefined,
        binaryPath: binaryPath ?? undefined,
      })
    }
    return results
  }
}
