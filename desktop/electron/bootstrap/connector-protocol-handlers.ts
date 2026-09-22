import type { ReturnTypeOfConnectorsService } from "../../app-capabilities/connectors/main/service-types"
import { PORTAL_TEST_CALLBACK_HANDLER } from "../../app-capabilities/connectors/shared/manifest"

export function createConnectorProtocolHandlers(registry: { get<T>(id: string): T }) {
  return {
    async [PORTAL_TEST_CALLBACK_HANDLER](params: Record<string, unknown>): Promise<void> {
      try {
        if (typeof params.deepLink !== "string") throw new Error()
        await registry.get<ReturnTypeOfConnectorsService>("core.connectors").handleCallback("portal-headless-test", params.deepLink)
      } catch {
        // Credential-bearing input and arbitrary downstream errors must not reach dialogs/logging.
        throw new Error("Portal 回调未被接受，请返回连接器重新连接。")
      }
    },
  }
}
