import type { CapabilityId } from "./naming"
import {
  buildPrimaryMcpToolActions,
  withPrimaryMcpTools,
} from "./mcp-tool-names"
import type {
  CapabilityDefinition,
  CapabilityDomainDefinition,
  McpToolDefinition,
} from "./types"

export type AutomationScopeParams =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }

export type AutomationScopeFilterParams =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId?: string }

export type AutomationRefParams = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type AutomationPolicyParams = {
  readonly missedRunPolicy?: "skip" | "run_once"
  readonly overlapPolicy?: "skip"
}

export type AutomationItemCreateParams = {
  readonly name: string
  readonly description?: string
  readonly enabled?: boolean
  readonly scope: AutomationScopeParams
  readonly cwd?: string
  readonly trigger: AutomationRefParams
  readonly executor: AutomationRefParams
  readonly policy?: AutomationPolicyParams
}

export type AutomationItemUpdateParams = {
  readonly automationId: string
  readonly patch: {
    readonly name?: string
    readonly description?: string
    readonly enabled?: boolean
    readonly scope?: AutomationScopeParams
    readonly cwd?: string
    readonly trigger?: AutomationRefParams
    readonly executor?: AutomationRefParams
    readonly policy?: AutomationPolicyParams
  }
}

export type AutomationItemListParams = {
  readonly enabled?: boolean
  readonly limit?: number
  readonly scope?: AutomationScopeFilterParams
}

export type AutomationItemIdParams = {
  readonly automationId: string
}

export type AutomationRunListParams = {
  readonly automationId: string
  readonly limit?: number
}

export type AutomationRunDisableParams = {
  readonly runId: string
}

export type AutomationRuntimeInspectParams = {
  readonly automationId?: string
}

const automationCapabilities: readonly CapabilityDefinition[] = [
  { id: "app.automation.item.list" as CapabilityId, title: "List automations", description: "List Synapse Automation item summaries.", mutates: false },
  { id: "app.automation.item.get" as CapabilityId, title: "Get automation", description: "Get one Synapse Automation item summary by id.", mutates: false },
  { id: "app.automation.item.create" as CapabilityId, title: "Create automation", description: "Create one Synapse Automation item.", mutates: true },
  { id: "app.automation.item.update" as CapabilityId, title: "Update automation", description: "Update one Synapse Automation item.", mutates: true },
  { id: "app.automation.item.delete" as CapabilityId, title: "Delete automation", description: "Delete one Synapse Automation item.", mutates: true, risk: "high" },
  { id: "app.automation.item.enable" as CapabilityId, title: "Enable automation", description: "Enable one Synapse Automation item.", mutates: true },
  { id: "app.automation.item.disable" as CapabilityId, title: "Disable automation", description: "Disable one Synapse Automation item.", mutates: true },
  { id: "app.automation.run.execute" as CapabilityId, title: "Run automation", description: "Manually run one Synapse Automation item.", mutates: true },
  { id: "app.automation.run.disable" as CapabilityId, title: "Stop automation run", description: "Stop one active Synapse Automation run. A successful result can be stopped, alreadyFinished, or stopRequested; stopRequested means the run may still be running and should be checked with automation_runtime_inspect or automation_run_list. Fails if the run is missing or no longer active.", mutates: true },
  { id: "app.automation.run.list" as CapabilityId, title: "List automation runs", description: "List recent runs for one Synapse Automation item.", mutates: false },
  { id: "app.automation.runtime.inspect" as CapabilityId, title: "Inspect automation runtime", description: "Inspect Automation timers, running item ids, and compact runtime state.", mutates: false },
  { id: "app.automation.webhook.list" as CapabilityId, title: "List Automation Webhooks", description: "List account Webhooks that can be used by builtin.webhook triggers.", mutates: false },
  { id: "app.automation.trigger_type.list" as CapabilityId, title: "List automation trigger types", description: "List registered Automation trigger type descriptors.", mutates: false },
  { id: "app.automation.executor_type.list" as CapabilityId, title: "List automation executor types", description: "List registered Automation executor type descriptors.", mutates: false },
]

export const AUTOMATION_DOMAIN: CapabilityDomainDefinition = {
  id: "automation",
  capabilities: automationCapabilities,
}

export const AUTOMATION_MCP_TOOL_ACTIONS: Record<string, string> = buildPrimaryMcpToolActions(
  automationCapabilities,
)

const automationIdProperty = {
  type: "string",
  description: "Automation item id. If only a name is known, call automation_item_list first because names are not unique.",
}

const automationScopeSchema = {
  anyOf: [
    { type: "object", properties: { type: { type: "string", enum: ["global"] } }, required: ["type"] },
    {
      type: "object",
      properties: {
        type: { type: "string", enum: ["project"] },
        projectId: { type: "string" },
      },
      required: ["type", "projectId"],
    },
  ],
}

const automationRefSchema = {
  type: "object",
  properties: {
    type: { type: "string", description: "Registered trigger or executor type id." },
    config: { type: "object", description: "Config validated by the matching registry. Use discovery tools first." },
  },
  required: ["type", "config"],
}

const automationPolicySchema = {
  type: "object",
  properties: {
    missedRunPolicy: { type: "string", enum: ["skip", "run_once"] },
    overlapPolicy: { type: "string", enum: ["skip"], description: "Automation currently supports skip only." },
  },
}

export function buildAutomationTools(): McpToolDefinition[] {
  return withPrimaryMcpTools([
    {
      name: "automation_item_list",
      description: "List Synapse Automation item summaries. Results intentionally omit raw trigger.config and executor.config.",
      inputSchema: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Optional filter for enabled or disabled Automations." },
          limit: { type: "number", description: "Optional maximum number of Automations to return after applying enabled/scope filters." },
          scope: {
            type: "object",
            description: "Optional scope filter. Pass { type: 'global' } or { type: 'project', projectId: '...' }. Omit projectId to match all project-scoped Automations.",
            properties: {
              type: { type: "string", enum: ["global", "project"] },
              projectId: { type: "string" },
            },
          },
        },
      },
    },
    {
      name: "automation_item_get",
      description: "Get one Synapse Automation item summary by automationId. The response does not include raw trigger or executor config.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_item_create",
      description: "Create one Synapse Automation. Call automation_trigger_type_list and automation_executor_type_list before building trigger/executor configs.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          enabled: { type: "boolean" },
          scope: automationScopeSchema,
          cwd: { type: "string" },
          trigger: automationRefSchema,
          executor: automationRefSchema,
          policy: automationPolicySchema,
        },
        required: ["name", "scope", "trigger", "executor"],
      },
    },
    {
      name: "automation_item_update",
      description: "Update one Synapse Automation. The patch may replace trigger or executor refs; use discovery tools before changing configs.",
      inputSchema: {
        type: "object",
        properties: {
          automationId: automationIdProperty,
          patch: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              enabled: { type: "boolean" },
              scope: automationScopeSchema,
              cwd: { type: "string" },
              trigger: automationRefSchema,
              executor: automationRefSchema,
              policy: automationPolicySchema,
            },
          },
        },
        required: ["automationId", "patch"],
      },
    },
    {
      name: "automation_item_delete",
      description: "Delete one Synapse Automation by automationId. This also removes its run history through AutomationService.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_item_enable",
      description: "Enable one Synapse Automation by automationId.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_item_disable",
      description: "Disable one Synapse Automation by automationId. This prevents future trigger runs but does not stop an active run.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_run_execute",
      description: "Manually run one Synapse Automation by automationId. Fails if the Automation is missing or no run starts. Use automation_run_list or automation_runtime_inspect for follow-up.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_run_disable",
      description: "Stop one active Automation run by runId. A successful result can be stopped, alreadyFinished, or stopRequested; stopRequested means the run may still be running and should be checked with automation_runtime_inspect or automation_run_list. Fails if the run is missing or no longer active.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string", description: "Automation run id." } },
        required: ["runId"],
      },
    },
    {
      name: "automation_run_list",
      description: "List recent runs for one Automation. Run summaries omit logs and raw outputs.",
      inputSchema: {
        type: "object",
        properties: {
          automationId: automationIdProperty,
          limit: { type: "number", description: "Optional maximum number of runs. Defaults to 20 and caps at 100." },
        },
        required: ["automationId"],
      },
    },
    {
      name: "automation_runtime_inspect",
      description: "Inspect Automation runtime state. Pass automationId for one item or omit it for all items.",
      inputSchema: { type: "object", properties: { automationId: { type: "string" } } },
    },
    {
      name: "automation_webhook_list",
      description: "List current account Webhooks for builtin.webhook trigger configs. Use publicId as trigger.config.webhookPublicId.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "automation_trigger_type_list",
      description: "List registered Automation trigger types, default configs, JSON Schemas, and trigger variables.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "automation_executor_type_list",
      description: "List registered Automation executor types from Action Runtime, including public config fields and platform-aware defaults.",
      inputSchema: { type: "object", properties: {} },
    },
  ], { sourcePrefix: "automation", primaryPrefix: "app_automation" })
}
