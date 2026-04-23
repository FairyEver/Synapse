import type { InputHTMLAttributes } from "react"
import type { SynapseBridge } from "@/types/bridge"

declare global {
  interface Window {
    synapse?: SynapseBridge
  }
}

declare module "react" {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string | boolean
    directory?: string | boolean
  }
}

export {}
