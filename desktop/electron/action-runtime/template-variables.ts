import { TEMPLATE_VARIABLE_RE, readVariablePath } from "../../automation-trigger-packages/variable-contract"
import type { AutomationTriggerKind } from "../../automation-trigger-packages/types.shared"

const MAX_FLATTEN_DEPTH = 8
const MAX_FLATTEN_KEYS = 200
// Raw roots live only for this in-memory execution, never in persisted variables.
const requestRoots = new WeakMap<Record<string, string>, Record<string, unknown>>()

export type AutomationTemplateVariableInput = {
  readonly triggerKind?: AutomationTriggerKind
  readonly executedAt?: string
  readonly runId?: string
  readonly triggerType: string
  readonly triggerConfig: Record<string, unknown>
  readonly triggeredBy: "trigger" | "manual" | "missed_run"
  readonly triggeredAt: string
  readonly scheduledAt: string
  readonly automationId: string
  readonly automationName: string
  readonly event?: {
    readonly occurredAt?: string
    readonly source: string
    readonly type: string
    readonly payload: Record<string, unknown>
    readonly receivedAt: string
  }
}

export function renderActionTemplate(
  template: string,
  variables: Record<string, string> | undefined,
): string {
  const source = variables ?? {}
  return template.replace(TEMPLATE_VARIABLE_RE, (_match, rawName: string) => {
    const name = rawName.trim()
    const roots = requestRoots.get(source)
    if (roots) for (const [prefix, value] of Object.entries(roots)) {
      if (!name.startsWith(`${prefix}.`) && !name.startsWith(`${prefix}#/`)) continue
      const result = readVariablePath(value, name.slice(prefix.length))
      if (!result.found) throw new Error(`字段不存在：${name}，请检查事件数据或字段路径`)
      return stringifyTemplateValue(result.value)
    }
    if (!Object.hasOwn(source, name)) throw new Error(`未知变量：${name}`)
    return source[name]
  })
}

export function renderStringRecordTemplates(
  record: Record<string, string> | undefined,
  variables: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined
  const rendered: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    rendered[renderActionTemplate(key, variables)] = renderActionTemplate(value, variables)
  }
  return rendered
}

export function buildAutomationTemplateVariables(
  input: AutomationTemplateVariableInput,
): Record<string, string> {
  const executedAt = input.executedAt ?? input.triggeredAt
  const triggerKind = input.triggerKind ?? (input.event ? "event" : input.triggeredBy === "manual" ? "schedule" : "event")
  const occurredAt = input.event?.occurredAt ?? input.event?.receivedAt ?? input.triggeredAt
  const timezone = typeof input.triggerConfig.timezone === "string" ? input.triggerConfig.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone
  const businessTime = input.triggeredBy === "manual" ? executedAt : input.event ? occurredAt : input.scheduledAt
  const dateParts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(businessTime))
  const datePart = (type: string) => dateParts.find(part => part.type === type)!.value
  const variables: Record<string, string> = {
    "trigger.type": input.triggerType,
    "trigger.triggeredBy": input.triggeredBy,
    "trigger.triggeredAt": occurredAt,
    "trigger.executedAt": executedAt,
    "trigger.runId": input.runId ?? "",
    "trigger.timezone": timezone,
    "trigger.date": `${datePart("year")}-${datePart("month")}-${datePart("day")}`,
    "trigger.automationId": input.automationId,
    "trigger.automationName": input.automationName,
  }

  // Event triggers keep scheduledAt as a compatibility alias for triggeredAt;
  // only the manual trigger has no scheduled timestamp at all.
  if (triggerKind !== "manual") variables["trigger.scheduledAt"] = input.event ? occurredAt : input.scheduledAt

  if (typeof input.triggerConfig.expr === "string") {
    variables["trigger.cron"] = input.triggerConfig.expr
  }
  if (typeof input.triggerConfig.everyMinutes === "number") {
    variables["trigger.everyMinutes"] = String(input.triggerConfig.everyMinutes)
  }
  if (typeof input.triggerConfig.anchor === "string") {
    variables["trigger.anchor"] = input.triggerConfig.anchor
  }

  if (input.event) {
    variables["trigger.source"] = input.event.source
    variables["trigger.eventType"] = input.event.type
    variables["trigger.receivedAt"] = input.event.receivedAt
    variables["trigger.payload"] = stringifyTemplateValue(input.event.payload)
    const request = asRecord(input.event.payload.request)
    if (request) {
      requestRoots.set(variables, Object.fromEntries(["body", "query", "headers"].flatMap(field => [
        [`trigger.request.${field}`, request[field]], [`trigger.payload.request.${field}`, request[field]],
      ])))
    }
    appendWebhookEventVariables(input.event.payload, variables)
    flattenValue("trigger.payload", input.event.payload, variables)
  }

  return variables
}

function appendWebhookEventVariables(
  payload: Record<string, unknown>,
  variables: Record<string, string>,
): void {
  const webhook = asRecord(payload.webhook)
  if (webhook) {
    variables["trigger.webhook"] = stringifyTemplateValue(webhook)
    assignStringVariable(variables, "trigger.webhook.id", webhook.id)
    assignStringVariable(variables, "trigger.webhook.publicId", webhook.publicId)
    assignStringVariable(variables, "trigger.webhook.name", webhook.name)
    for (const field of ["id", "publicId", "name"]) {
      if (Object.hasOwn(variables, `trigger.webhook.${field}`)) variables[`trigger.payload.webhook.${field}`] = variables[`trigger.webhook.${field}`]!
    }
  }

  assignStringVariable(variables, "trigger.deliveryId", payload.deliveryId)

  const request = asRecord(payload.request)
  if (!request) return
  variables["trigger.request"] = stringifyTemplateValue(request)
  assignStringVariable(variables, "trigger.request.method", request.method)
  variables["trigger.request.contentType"] = typeof request.contentType === "string" ? request.contentType : ""
  variables["trigger.request.bodyText"] = typeof request.bodyText === "string" ? request.bodyText : ""
  variables["trigger.request.remoteAddress"] = typeof request.remoteAddress === "string" ? request.remoteAddress : ""
  for (const field of ["method", "contentType", "bodyText", "remoteAddress"]) {
    if (Object.hasOwn(variables, `trigger.request.${field}`)) variables[`trigger.payload.request.${field}`] = variables[`trigger.request.${field}`]!
  }
  assignStringVariable(variables, "trigger.payload.request.receivedAt", request.receivedAt)
  const fields = ["body", "query", "headers"] as const
  // Declared whole values must remain available even if body leaves fill the budget.
  for (const field of fields) {
    const value = stringifyTemplateValue(request[field])
    variables[`trigger.request.${field}`] = value
    variables[`trigger.payload.request.${field}`] = value
  }
  for (const field of fields) {
    if (!(field in request)) continue
    flattenValue(`trigger.request.${field}`, request[field], variables, 0, true)
    flattenValue(`trigger.payload.request.${field}`, request[field], variables, 0, true)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function assignStringVariable(
  variables: Record<string, string>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string") variables[key] = value
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function flattenValue(
  prefix: string,
  value: unknown,
  output: Record<string, string>,
  depth = 0,
  includeContainers = false,
): void {
  if (Object.keys(output).length >= MAX_FLATTEN_KEYS || depth > MAX_FLATTEN_DEPTH) return
  if (value === null || value === undefined) {
    output[prefix] = ""
    return
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output[prefix] = String(value)
    return
  }
  if (includeContainers) output[prefix] = stringifyTemplateValue(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (Object.keys(output).length >= MAX_FLATTEN_KEYS) break
      if (index in value) flattenValue(`${prefix}.${String(index)}`, value[index], output, depth + 1, includeContainers)
    }
    return
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (Object.keys(output).length >= MAX_FLATTEN_KEYS) break
      flattenValue(`${prefix}.${key}`, child, output, depth + 1, includeContainers)
    }
  }
}
