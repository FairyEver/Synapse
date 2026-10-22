import type { ConnectorItem } from "../../connectors/shared/schema"
import type { BuiltinConnectorDefinition, ConnectorDriver, ProbeResult } from "../../connectors/main/types"
import type { WecomConnectionService, WecomConnectionSnapshot } from "./connection-service"

type WecomDefinition = BuiltinConnectorDefinition & {
  readonly integration: { readonly kind: "wecom" }
}

export function createWecomConnectorDriver(deps: {
  readonly service: WecomConnectionService
}): ConnectorDriver {
  let unsubscribe: (() => void) | undefined

  function requireDefinition(definition: BuiltinConnectorDefinition): WecomDefinition {
    if (definition.integration.kind !== "wecom") throw new Error("连接器类型无效。")
    return definition as WecomDefinition
  }

  function item(definition: WecomDefinition, snapshot: WecomConnectionSnapshot): ConnectorItem {
    return {
      id: definition.id,
      kind: "wecom",
      name: definition.name,
      description: definition.description,
      enabled: snapshot.enabled,
      probeStatus: snapshot.status === "connected"
        ? "ready"
        : ["connecting", "verifying"].includes(snapshot.status)
          ? "checking"
          : ["failed", "reconnect_required"].includes(snapshot.status)
            ? "error"
            : "idle",
      connectionStatus: snapshot.status,
      canRetry: snapshot.status === "failed" || snapshot.status === "reconnect_required",
      ...(snapshot.qrCodeDataUrl ? { qrCodeDataUrl: snapshot.qrCodeDataUrl } : {}),
      ...(snapshot.errorMessage ? { errorMessage: snapshot.errorMessage } : {}),
      ...(snapshot.connectedAt && snapshot.lastValidatedAt
        ? { wecom: { connectedAt: snapshot.connectedAt, lastValidatedAt: snapshot.lastValidatedAt } }
        : {}),
    }
  }

  return {
    probe: async (definition): Promise<ProbeResult> => {
      const snapshot = await deps.service.snapshot()
      requireDefinition(definition)
      return snapshot.status === "connected"
        ? { ok: true, toolCount: 0 }
        : { ok: false, errorCode: "permission_denied" }
    },
    createAgentContribution: () => ({ mcpServers: [], skillPackageIds: [] }),
    lifecycle: {
      async initialize(onChanged) {
        unsubscribe = deps.service.onChanged(onChanged)
      },
      async item(definition) {
        const typed = requireDefinition(definition)
        return item(typed, await deps.service.snapshot())
      },
      async connect(definition) {
        const typed = requireDefinition(definition)
        return item(typed, await deps.service.connect())
      },
      async disconnect(definition) {
        requireDefinition(definition)
        await deps.service.disconnect()
      },
      async retry(definition) {
        const typed = requireDefinition(definition)
        return item(typed, await deps.service.connect())
      },
      dispose() {
        unsubscribe?.()
        unsubscribe = undefined
      },
    },
  }
}
