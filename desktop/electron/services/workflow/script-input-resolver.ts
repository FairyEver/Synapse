import type { SecretsService } from "../../../app-capabilities/secrets/main/service"
import {
  snapshotStrictJsonObject,
  snapshotStrictJsonValue,
} from "../../../app-capabilities/script-runtime/main/strict-json-input"
import type { JsonObject, JsonValue } from "../../../app-capabilities/script-runtime/shared/json"
import {
  buildJsonInput,
  readJsonPath,
  type WorkflowScriptInputBinding,
} from "../../../app-capabilities/script-runtime/shared/input"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import type { NodeRuntimeDeps } from "../../../workflow-nodes/types"
import type { WorkflowDefinition } from "../../../src/types/workflow"

export type PublicNodeValues = Readonly<Record<string, Readonly<Record<string, JsonValue>>>>

export async function resolveWorkflowScriptInputs(input: {
  readonly bindings: readonly WorkflowScriptInputBinding[]
  readonly definition: WorkflowDefinition
  readonly paramValues: Record<string, unknown>
  readonly legacyNodeOutputs: Readonly<Record<string, string>>
  readonly publicNodeValues: PublicNodeValues
  readonly runtimeDeps?: NodeRuntimeDeps
}): Promise<Record<string, JsonValue>> {
  const resolved: Array<{ name: string; value: JsonValue }> = []
  let paramValuesSnapshot: Readonly<Record<string, JsonValue>> | undefined
  let legacyNodeOutputsSnapshot: Readonly<Record<string, JsonValue>> | undefined
  let publicNodeValuesSnapshot: JsonObject | undefined

  for (const binding of input.bindings) {
    const source = binding.source
    let value: unknown
    if (source.type === "static_json") {
      value = source.value
    } else if (source.type === "param") {
      paramValuesSnapshot ??= snapshotStrictJsonObject(input.paramValues)
      if (!Object.prototype.hasOwnProperty.call(paramValuesSnapshot, source.param)) {
        throw new Error(`输入「${binding.name}」引用的参数不存在：${source.param}`)
      }
      value = paramValuesSnapshot[source.param]
    } else if (source.type === "node_output") {
      legacyNodeOutputsSnapshot ??= snapshotStrictJsonObject(input.legacyNodeOutputs)
      if (!Object.prototype.hasOwnProperty.call(legacyNodeOutputsSnapshot, source.node)) {
        throw new Error(`输入「${binding.name}」引用的节点字符串输出不可用：${source.node}`)
      }
      value = legacyNodeOutputsSnapshot[source.node]
    } else if (source.type === "node_value") {
      const sourceNode = input.definition.nodes.find((node) => node.id === source.node)
      if (!sourceNode) throw new Error(`输入「${binding.name}」引用的节点不存在：${source.node}`)
      const declaredOutputs = nodeTypeRegistry.getManifest(sourceNode.type).publicOutputs ?? []
      if (!declaredOutputs.includes(source.output)) {
        throw new Error(`节点「${sourceNode.name}」未声明公共输出「${source.output}」`)
      }
      publicNodeValuesSnapshot ??= snapshotStrictJsonObject(input.publicNodeValues)
      if (!Object.prototype.hasOwnProperty.call(publicNodeValuesSnapshot, source.node)) {
        throw new Error(`节点「${sourceNode.name}」的公共输出「${source.output}」不可用`)
      }
      const outputs = snapshotStrictJsonObject(publicNodeValuesSnapshot[source.node])
      if (!Object.prototype.hasOwnProperty.call(outputs, source.output)) {
        throw new Error(`节点「${sourceNode.name}」的公共输出「${source.output}」不可用`)
      }
      value = readJsonPath(outputs[source.output], source.path)
    } else {
      const secrets = input.runtimeDeps?.resolveService?.<SecretsService>("core.secrets")
      if (!secrets) throw new Error("密钥服务不可用")
      const secret = await secrets.get({ name: source.name, includeValue: true })
      if (!("value" in secret)) throw new Error(`密钥值不可用：${source.name}`)
      value = secret.value
    }
    resolved.push({ name: binding.name, value: snapshotStrictJsonValue(value) })
  }

  return buildJsonInput(resolved)
}

export function collectPublicNodeValues(input: {
  readonly nodeType: string
  readonly outputs: Record<string, unknown> | undefined
}): Record<string, JsonValue> {
  const publicNames = nodeTypeRegistry.getManifest(input.nodeType).publicOutputs ?? []
  const outputs = input.outputs === undefined
    ? undefined
    : snapshotStrictJsonObject(input.outputs)
  const publicValues: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const name of publicNames) {
    if (!outputs || !Object.prototype.hasOwnProperty.call(outputs, name)) {
      throw new Error(`节点未产生声明的公共输出「${name}」`)
    }
    publicValues[name] = outputs[name]
  }
  return publicValues
}
