import type { SynapseBridge } from "@/types/bridge"

declare global {
  interface Window {
    synapse?: SynapseBridge
  }
}

export {}
