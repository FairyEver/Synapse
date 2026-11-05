const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu
const MAX_FLATTEN_DEPTH = 8
const MAX_FLATTEN_KEYS = 200
const OPTIONAL_WEBHOOK_REQUEST_VARIABLE_PREFIXES = [
  "trigger.request.body.",
  "trigger.request.query.",
  "trigger.request.headers.",
  "trigger.payload.request.body.",
  "trigger.payload.request.query.",
  "trigger.payload.request.headers.",
]

export type AutomationTemplateVariableInput = {
  readonly triggerType: string
  readonly triggerConfig: Record<string, unknown>
  readonly triggeredBy: "trigger" | "manual" | "missed_run"
  readonly triggeredAt: string
  readonly scheduledAt: string
  readonly automationId: string
  readonly automationName: string
  readonly event?: {
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
  return template.replace(TEMPLATE_VARIABLE_RE, (_match, name: string) => {
    if (!(name in source)) {
      if (isOptionalWebhookRequestVariable(name)) return ""
      throw new Error(`未知变量：${name}`)
    }
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
  const variables: Record<string, string> = {
    "trigger.type": input.triggerType,
    "trigger.triggeredBy": input.triggeredBy,
    "trigger.triggeredAt": input.triggeredAt,
    "trigger.scheduledAt": input.scheduledAt,
    "trigger.automationId": input.automationId,
    "trigger.automationName": input.automationName,
  }

  if (typeof input.triggerConfig.expr === "string") {
    variables["trigger.cron"] = input.triggerConfig.expr
  }
  if (typeof input.triggerConfig.timezone === "string") {
    variables["trigger.timezone"] = input.triggerConfig.timezone
  } else if ("expr" in input.triggerConfig) {
    variables["trigger.timezone"] = ""
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
  }

  assignStringVariable(variables, "trigger.deliveryId", payload.deliveryId)

  const request = asRecord(payload.request)
  if (!request) return
  variables["trigger.request"] = stringifyTemplateValue(request)
  assignStringVariable(variables, "trigger.request.method", request.method)
  variables["trigger.request.contentType"] = typeof request.contentType === "string" ? request.contentType : ""
  variables["trigger.request.bodyText"] = typeof request.bodyText === "string" ? request.bodyText : ""
  variables["trigger.request.remoteAddress"] = typeof request.remoteAddress === "string" ? request.remoteAddress : ""
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

function isOptionalWebhookRequestVariable(name: string): boolean {
  return OPTIONAL_WEBHOOK_REQUEST_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))
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
