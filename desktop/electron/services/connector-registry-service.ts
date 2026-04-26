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
      { name: "owner_open_id", kind: "string" },
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
      { name: "owner_open_id", kind: "string" },
      { name: "domain", kind: "string" },
      { name: "port", kind: "string", defaultValue: "8080" },
      { name: "callback_path", kind: "string", defaultValue: "/feishu/webhook" },
      { name: "encrypt_key", kind: "secret" },
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
