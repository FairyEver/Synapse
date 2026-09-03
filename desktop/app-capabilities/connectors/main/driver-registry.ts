import type { BuiltinConnectorDefinition, ConnectorDriver, ConnectorIntegration } from "./types"

export class ConnectorDriverRegistry {
  private readonly drivers = new Map<ConnectorIntegration["kind"], ConnectorDriver>()

  register(kind: ConnectorIntegration["kind"], driver: ConnectorDriver): void {
    if (this.drivers.has(kind)) throw new Error(`Connector driver already registered: ${kind}`)
    this.drivers.set(kind, driver)
  }

  resolve(definition: BuiltinConnectorDefinition): ConnectorDriver {
    const driver = this.drivers.get(definition.integration.kind)
    if (!driver) throw new Error(`Unsupported connector integration: ${definition.integration.kind}`)
    return driver
  }
}
