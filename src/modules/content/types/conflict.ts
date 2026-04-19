import type { SynapseDeleteContentPayload } from "@/types/content"

type ConflictState<T> =
  | {
      latestHistoryDirname: string
      latestModifiedByDisplayName: string
      latestModifiedAt: string
      mode: "delete"
      payload: SynapseDeleteContentPayload
    }
  | {
      latestHistoryDirname: string
      latestModifiedByDisplayName: string
      latestModifiedAt: string
      mode: "save"
      payload: T
    }

export type { ConflictState }
