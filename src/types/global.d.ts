import type { SynapseConfig, SynapseConfigPatch } from "@/types/config"

declare global {
  interface Window {
    synapse?: {
      platform: string
      versions: {
        chrome: string
        electron: string
        node: string
      }
      config: {
        get: () => Promise<SynapseConfig>
        update: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
      }
    }
  }
}

export {}
