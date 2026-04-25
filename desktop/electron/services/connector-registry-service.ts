import type {
  SynapseConnectorDescriptor,
  SynapseConnectorDraft,
  SynapseConnectorEntry,
  SynapseConnectorIssue,
  SynapseConnectorOptionDefinition,
  SynapseConnectorSecretDraft,
  SynapseConnectorStatus,
} from "../../src/types/connector"

export type ConnectorDraftInput = {
  type: string
  name?: string
  enabled?: boolean
  options?: Record<string, unknown>
  secretRefs?: Record<string, string>
}

const COMMON_OPTIONS: SynapseConnectorOptionDefinition[] = [
  { name: "allow_from", kind: "string", defaultValue: "*" },
  { name: "share_session_in_channel", kind: "boolean", defaultValue: false },
]

const CC_CONNECTOR_DESCRIPTORS: SynapseConnectorDescriptor[] = [
  {
    type: "feishu",
    label: "Feishu",
    transport: "websocket",
    options: [
      { name: "app_id", kind: "string", required: true },
      { name: "app_secret", kind: "secret", required: true },
      { name: "domain", kind: "string" },
      { name: "enable_feishu_card", kind: "boolean", defaultValue: true },
      { name: "group_reply_all", kind: "boolean", defaultValue: false },
      { name: "thread_isolation", kind: "boolean", defaultValue: false },
      { name: "progress_style", kind: "string", defaultValue: "legacy" },
      ...COMMON_OPTIONS,
    ],
    capabilities: [
      "text.in",
      "text.out",
      "image.in",
      "image.out",
      "file.in",
      "file.out",
      "audio.in",
      "audio.out",
      "markdown.out",
      "card.out",
      "button.out",
      "message.update",
      "reply-context.reconstruct",
      "progress.card",
      "qr.onboarding",
    ],
  },
  {
    type: "lark",
    label: "Lark",
    transport: "websocket",
    options: [
      { name: "app_id", kind: "string", required: true },
      { name: "app_secret", kind: "secret", required: true },
      { name: "domain", kind: "string" },
      { name: "port", kind: "string", defaultValue: "8080" },
      { name: "callback_path", kind: "string", defaultValue: "/feishu/webhook" },
      { name: "encrypt_key", kind: "secret" },
      { name: "enable_feishu_card", kind: "boolean", defaultValue: true },
      { name: "progress_style", kind: "string", defaultValue: "legacy" },
      ...COMMON_OPTIONS,
    ],
    capabilities: [
      "text.in",
      "text.out",
      "image.in",
      "image.out",
      "file.in",
      "file.out",
      "audio.in",
      "audio.out",
      "markdown.out",
      "card.out",
      "button.out",
      "message.update",
      "reply-context.reconstruct",
      "progress.card",
      "qr.onboarding",
    ],
  },
  {
    type: "dingtalk",
    label: "DingTalk",
    transport: "stream",
    options: [
      { name: "client_id", kind: "string", required: true },
      { name: "client_secret", kind: "secret", required: true },
      ...COMMON_OPTIONS,
    ],
    capabilities: ["text.in", "text.out", "markdown.out", "audio.in"],
  },
  {
    type: "telegram",
    label: "Telegram",
    transport: "long-poll",
    options: [
      { name: "token", kind: "secret", required: true },
      { name: "group_reply_all", kind: "boolean", defaultValue: false },
      { name: "enable_reactions", kind: "boolean", defaultValue: false },
      { name: "proxy", kind: "string" },
      ...COMMON_OPTIONS,
    ],
    capabilities: [
      "text.in",
      "text.out",
      "image.in",
      "image.out",
      "file.in",
      "file.out",
      "audio.in",
      "audio.out",
      "typing",
      "message.update",
      "button.out",
      "reply-context.reconstruct",
    ],
  },
  {
    type: "slack",
    label: "Slack",
    transport: "socket-mode",
    options: [
      { name: "bot_token", kind: "secret", required: true },
      { name: "app_token", kind: "secret", required: true },
      ...COMMON_OPTIONS,
    ],
    capabilities: ["text.in", "text.out", "image.in", "file.in", "audio.in"],
  },
  {
    type: "discord",
    label: "Discord",
    transport: "gateway",
    options: [
      { name: "token", kind: "secret", required: true },
      { name: "guild_id", kind: "string" },
      { name: "group_reply_all", kind: "boolean", defaultValue: false },
      { name: "thread_isolation", kind: "boolean", defaultValue: false },
      { name: "progress_style", kind: "string", defaultValue: "legacy" },
      { name: "proxy", kind: "string" },
      ...COMMON_OPTIONS,
    ],
    capabilities: [
      "text.in",
      "text.out",
      "image.in",
      "file.out",
      "button.out",
      "card.out",
      "message.update",
      "reply-context.reconstruct",
      "progress.card",
    ],
  },
  {
    type: "line",
    label: "LINE",
    transport: "http-webhook",
    options: [
      { name: "channel_secret", kind: "secret", required: true },
      { name: "channel_token", kind: "secret", required: true },
      { name: "port", kind: "string", defaultValue: "8080" },
      { name: "callback_path", kind: "string", defaultValue: "/callback" },
      { name: "allow_from", kind: "string", defaultValue: "*" },
    ],
    capabilities: ["text.in", "text.out"],
  },
  {
    type: "wecom",
    label: "WeCom",
    transport: "webhook-or-websocket",
    options: [
      { name: "mode", kind: "string" },
      { name: "corp_id", kind: "string" },
      { name: "corp_secret", kind: "secret" },
      { name: "agent_id", kind: "string" },
      { name: "callback_token", kind: "secret" },
      { name: "callback_aes_key", kind: "secret" },
      { name: "bot_id", kind: "string" },
      { name: "bot_secret", kind: "secret" },
      { name: "port", kind: "string", defaultValue: "8081" },
      { name: "callback_path", kind: "string", defaultValue: "/wecom/callback" },
      { name: "allow_from", kind: "string", defaultValue: "*" },
    ],
    capabilities: [
      "text.in",
      "text.out",
      "markdown.out",
      "image.in",
      "file.in",
      "audio.in",
      "reply-context.reconstruct",
      "async.recover",
    ],
  },
  {
    type: "weibo",
    label: "Weibo",
    transport: "websocket",
    options: [
      { name: "app_id", kind: "string", required: true },
      { name: "app_secret", kind: "secret", required: true },
      { name: "token_endpoint", kind: "string" },
      { name: "ws_endpoint", kind: "string" },
      { name: "allow_from", kind: "string", defaultValue: "*" },
    ],
    capabilities: ["text.in", "text.out", "image.in", "image.out", "file.out"],
  },
  {
    type: "weixin",
    label: "Weixin",
    transport: "long-poll",
    options: [
      { name: "token", kind: "secret", required: true },
      { name: "base_url", kind: "string" },
      { name: "cdn_base_url", kind: "string" },
      { name: "account_id", kind: "string", defaultValue: "default" },
      { name: "route_tag", kind: "string" },
      { name: "long_poll_timeout_ms", kind: "number", defaultValue: 35000 },
      { name: "state_dir", kind: "string" },
      { name: "allow_from", kind: "string", defaultValue: "*" },
    ],
    capabilities: ["text.in", "text.out", "image.in", "image.out", "file.in", "file.out", "audio.in", "audio.out", "typing", "qr.onboarding"],
  },
  {
    type: "qq",
    label: "QQ",
    transport: "websocket",
    options: [
      { name: "bot_uin", kind: "string", required: true },
      { name: "ws_url", kind: "string" },
      { name: "access_token", kind: "secret" },
      ...COMMON_OPTIONS,
    ],
    capabilities: ["text.in", "text.out", "image.in", "audio.in"],
  },
  {
    type: "qqbot",
    label: "QQ Bot",
    transport: "gateway",
    options: [
      { name: "app_id", kind: "string", required: true },
      { name: "app_secret", kind: "secret", required: true },
      { name: "sandbox", kind: "boolean", defaultValue: false },
      { name: "intents", kind: "number" },
      { name: "markdown_support", kind: "boolean", defaultValue: false },
      ...COMMON_OPTIONS,
    ],
    capabilities: ["text.in", "text.out", "markdown.out", "reply-context.reconstruct"],
  },
]

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function stableSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "connector"
}

function optionHasValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0
  }

  return value !== undefined && value !== null
}

function cleanOptionValue(value: unknown): string | boolean | number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value
  }

  return undefined
}

function connectorSecretRef(type: string, name: string, optionName: string): string {
  return `connector:${stableSlug(type)}:${stableSlug(name)}:${stableSlug(optionName)}`
}

function defaultConnectorName(type: string): string {
  return stableSlug(type)
}

function descriptorMap(descriptors: readonly SynapseConnectorDescriptor[]): Map<string, SynapseConnectorDescriptor> {
  return new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]))
}

export class ConnectorRegistryService {
  private readonly descriptors = descriptorMap(CC_CONNECTOR_DESCRIPTORS)

  register(descriptor: SynapseConnectorDescriptor): void {
    this.descriptors.set(descriptor.type, {
      ...descriptor,
      options: [...descriptor.options],
      capabilities: [...descriptor.capabilities],
    })
  }

  listDescriptors(): SynapseConnectorDescriptor[] {
    return Array.from(this.descriptors.values())
      .map((descriptor) => ({
        ...descriptor,
        options: [...descriptor.options],
        capabilities: [...descriptor.capabilities],
      }))
      .sort((a, b) => a.type.localeCompare(b.type))
  }

  getDescriptor(type: string): SynapseConnectorDescriptor | null {
    const descriptor = this.descriptors.get(type)
    return descriptor
      ? {
          ...descriptor,
          options: [...descriptor.options],
          capabilities: [...descriptor.capabilities],
        }
      : null
  }

  createConnectorDraft(input: ConnectorDraftInput): SynapseConnectorDraft {
    const type = stableSlug(input.type)
    const name = trimString(input.name) ?? defaultConnectorName(type)
    const descriptor = this.descriptors.get(type)

    if (!descriptor) {
      const connector: SynapseConnectorEntry = {
        id: `connector:${type}:${stableSlug(name)}`,
        schemaVersion: 1,
        type,
        name,
        enabled: input.enabled ?? false,
        status: "invalid",
        options: {},
        secretRefs: {},
        capabilities: [],
      }
      return {
        connector,
        secrets: [],
        issues: [{
          code: "unknown_connector_type",
          message: `unknown connector type ${JSON.stringify(type)}`,
        }],
        warnings: [],
      }
    }

    const options: Record<string, string | boolean | number> = {}
    const secretRefs: Record<string, string> = { ...(input.secretRefs ?? {}) }
    const secrets: SynapseConnectorSecretDraft[] = []
    const issues: SynapseConnectorIssue[] = []
    const warnings: string[] = []
    const rawOptions = input.options ?? {}

    for (const option of descriptor.options) {
      const value = rawOptions[option.name]

      if (option.kind === "secret") {
        const secretValue = trimString(value)
        if (secretValue) {
          const ref = secretRefs[option.name] ?? connectorSecretRef(type, name, option.name)
          secretRefs[option.name] = ref
          secrets.push({
            id: ref,
            kind: "generic",
            description: `${descriptor.label} ${option.name}`,
            value: secretValue,
          })
        }
        continue
      }

      const cleaned = cleanOptionValue(value)
      if (cleaned !== undefined) {
        options[option.name] = cleaned
      } else if (option.defaultValue !== undefined) {
        options[option.name] = option.defaultValue
      }
    }

    for (const option of descriptor.options) {
      if (!option.required) {
        continue
      }

      const satisfied = option.kind === "secret"
        ? optionHasValue(secretRefs[option.name])
        : optionHasValue(options[option.name])
      if (!satisfied) {
        issues.push({
          code: "missing_required_option",
          option: option.name,
          message: `${descriptor.type}.${option.name} is required`,
        })
      }
    }

    const allowFrom = typeof options.allow_from === "string" ? options.allow_from : undefined
    if (!allowFrom || allowFrom === "*") {
      warnings.push("allow_from is open to all users")
    }

    const enabled = input.enabled ?? true
    const status: SynapseConnectorStatus = !enabled
      ? "disabled"
      : issues.length > 0 ? "invalid" : "configured"

    return {
      connector: {
        id: `connector:${type}:${stableSlug(name)}`,
        schemaVersion: 1,
        type,
        name,
        enabled,
        status,
        options,
        secretRefs,
        capabilities: [...descriptor.capabilities],
        ...(allowFrom ? { allowFrom } : undefined),
      },
      secrets,
      issues,
      warnings,
    }
  }
}

export function createDefaultConnectorRegistryService(): ConnectorRegistryService {
  return new ConnectorRegistryService()
}
