import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const ruleIdProperty = {
  type: "string",
  description: "Opaque model price rule ID from a rule's id field. This is not a model name and not modelPattern. Call model_price_rule_list first when only modelPattern is known.",
}

const priceProperty = (label: string) => ({
  type: "number",
  minimum: 0,
  description: `${label} price in CNY per 1M tokens. Use 0 when this token type is not charged.`,
})

const modelPriceCapabilities: readonly CapabilityDefinition[] = [
  { id: "model_price.used_model.list" as CapabilityId, title: "List used models", description: "List models seen in CC and Codex usage data with current price-rule match status.", mutates: false },
  { id: "model_price.rule.list" as CapabilityId, title: "List price rules", description: "List model price rules, including disabled rules. The id field is the opaque rule ID, not a rule name.", mutates: false },
  { id: "model_price.rule.get" as CapabilityId, title: "Get price rule", description: "Get one model price rule by opaque ruleId.", mutates: false },
  { id: "model_price.rule.create" as CapabilityId, title: "Create price rule", description: "Create one model price rule.", mutates: true },
  { id: "model_price.rule.update" as CapabilityId, title: "Update price rule", description: "Partially update one model price rule by opaque ruleId.", mutates: true },
  { id: "model_price.rule.delete" as CapabilityId, title: "Delete price rule", description: "Hard-delete one model price rule by opaque ruleId.", mutates: true },
  { id: "model_price.rule.enable" as CapabilityId, title: "Enable price rule", description: "Enable one model price rule.", mutates: true },
  { id: "model_price.rule.disable" as CapabilityId, title: "Disable price rule", description: "Disable one model price rule without deleting it.", mutates: true },
]

export const MODEL_PRICE_DOMAIN: CapabilityDomainDefinition = {
  id: "model_price",
  capabilities: modelPriceCapabilities,
}

export const MODEL_PRICE_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  modelPriceCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

export function buildModelPriceTools(): McpToolDefinition[] {
  const priceFields = {
    inputPer1M: priceProperty("Input"),
    outputPer1M: priceProperty("Output"),
    cacheReadPer1M: priceProperty("Cache read"),
    cacheWritePer1M: priceProperty("Cache write"),
    reasoningPer1M: priceProperty("Reasoning"),
  }

  return [
    {
      name: "model_price_used_model_list",
      description: "List models used by CC and Codex with current enabled price-rule match status. matchedRuleId is a rule ID, not a model name. This reads indexed usage data and does not refresh usage logs.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["all", "cc", "codex"], description: "Usage source filter. Defaults to all." },
          range: { type: "string", enum: ["today", "7d", "30d", "90d", "all"], description: "Usage date range. Defaults to all." },
          limit: { type: "number", minimum: 1, description: "Maximum number of model rows to return. Defaults to 200." },
        },
      },
    },
    {
      name: "model_price_rule_list",
      description: "List all model price rules, including disabled rules. Each rule's id is an opaque rule ID, not a model name. Call this before update, delete, enable, or disable when only a model name is known.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "model_price_rule_get",
      description: "Get one model price rule by opaque ruleId.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
    {
      name: "model_price_rule_create",
      description: "Create a model price rule. Prices are CNY per 1M tokens. Missing price fields default to 0 and enabled defaults to true.",
      inputSchema: {
        type: "object",
        properties: {
          modelPattern: { type: "string", description: "User-visible model matching pattern: a model-name substring or wildcard pattern. Must not be empty." },
          ...priceFields,
          enabled: { type: "boolean", description: "Whether the rule participates in matching. Defaults to true." },
        },
        required: ["modelPattern"],
      },
    },
    {
      name: "model_price_rule_update",
      description: "Partially update one model price rule by opaque ruleId. Only provided fields change; omitted prices keep their current values.",
      inputSchema: {
        type: "object",
        properties: {
          ruleId: ruleIdProperty,
          modelPattern: { type: "string", description: "Replacement user-visible model matching pattern. Must not be empty when provided." },
          ...priceFields,
        },
        required: ["ruleId"],
      },
    },
    {
      name: "model_price_rule_delete",
      description: "Hard-delete one model price rule by opaque ruleId.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
    {
      name: "model_price_rule_enable",
      description: "Enable one model price rule by opaque ruleId.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
    {
      name: "model_price_rule_disable",
      description: "Disable one model price rule by opaque ruleId without deleting it.",
      inputSchema: { type: "object", properties: { ruleId: ruleIdProperty }, required: ["ruleId"] },
    },
  ]
}
