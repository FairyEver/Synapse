import { createContext } from "react"

/** Applied after OpenUI evaluates bindings and expressions, before components render. */
export const AgentSharePrivacyContext = createContext(false)

/** Host-frozen Generated UI states for automated sharing; undefined keeps manual restore. */
export const AgentShareSnapshotsContext = createContext<Readonly<Record<string, import("@/types/agent-generated-ui").GeneratedUiSnapshot>> | undefined>(undefined)
