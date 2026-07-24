import type { SecretsService } from "../../secrets/main/service"
import type { JsonValue } from "../shared/json"
import {
  buildJsonInput,
  readJsonPath,
  type AutomationScriptInputBinding,
} from "../shared/input"
import { snapshotStrictJsonValue } from "./strict-json-input"

export async function resolveAutomationScriptInputs(input: {
  readonly bindings: readonly AutomationScriptInputBinding[]
  readonly triggerInput: unknown
  readonly secrets: Pick<SecretsService, "get">
}): Promise<Record<string, JsonValue>> {
  const values: Array<{ name: string; value: JsonValue }> = []
  for (const binding of input.bindings) {
    let value: unknown
    if (binding.source.type === "static") {
      value = binding.source.value
    } else if (binding.source.type === "trigger") {
      if (input.triggerInput === undefined) throw new Error("Automation trigger input is unavailable.")
      const triggerInput = snapshotStrictJsonValue(input.triggerInput)
      value = readJsonPath(triggerInput, binding.source.path)
    } else {
      const secret = await input.secrets.get({ name: binding.source.name, includeValue: true })
      if (!("value" in secret)) throw new Error(`密钥值不可用：${binding.source.name}`)
      value = secret.value
    }
    values.push({ name: binding.name, value: snapshotStrictJsonValue(value) })
  }
  return buildJsonInput(values)
}
