import { createHash } from "node:crypto"
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  WecomMailBindingV1,
  WecomMailStateV1,
} from "../../../electron/runtime/data-repo/schemas/connectors"
import type { SynapseAccountState } from "../../../src/types/account"
import type {
  WecomMailDetail,
  WecomMailGetInput,
  WecomMailSearchInput,
  WecomMailSearchResult,
  WecomMailSendInput,
  WecomMailSendResult,
} from "../shared/wecom-mail"
import type { ConnectorItem } from "../shared/schema"
import type { BuiltinConnectorDefinition, ConnectorDriver, ProbeResult } from "./types"
import { WecomCliError, type WecomCliAccount, type WecomCliAuthSession, type WecomCliClient } from "./wecom-cli-client"

type WecomMailDefinition = BuiltinConnectorDefinition & {
  readonly integration: { readonly kind: "wecom-mail" }
}

type Attempt = {
  readonly ownerUserId: string
  readonly generation: string
  status: NonNullable<ConnectorItem["connectionStatus"]>
  session?: WecomCliAuthSession
  qrCodeDataUrl?: string
  errorMessage?: string
  warningMessage?: string
  helpUrl?: string
  account?: WecomCliAccount
}

export type WecomMailDriverDeps = {
  readonly state: DataNamespace<WecomMailStateV1>
  readonly account: {
    getState(): SynapseAccountState
    onBeforeIdentityChange(listener: () => void | Promise<void>): () => void
    onStateChanged(listener: (state: SynapseAccountState) => void): () => void
  }
  readonly client: WecomCliClient
  readonly now?: () => number
}

export function createWecomMailDriver(deps: WecomMailDriverDeps): ConnectorDriver {
  const attempts = new Map<string, Attempt>()
  const restoring = new Set<string>()
  const now = deps.now ?? Date.now
  let notify = () => undefined as void
  let unsubscribe: Array<() => void> = []
  let restoredOwner: string | null = null

  function ownerUserId(): string | null {
    const state = deps.account.getState()
    return state.status === "authenticated" && state.profile.user.status === "active"
      ? state.profile.user.id
      : null
  }

  function attemptKey(owner: string, definition: WecomMailDefinition): string {
    return createHash("sha256").update(`${owner}:${definition.id}`).digest("hex")
  }

  function requireDefinition(definition: BuiltinConnectorDefinition): WecomMailDefinition {
    if (definition.integration.kind !== "wecom-mail") throw new WecomCliError("invalid_response", "连接器类型无效。")
    return definition as WecomMailDefinition
  }

  function requireOwner(): string {
    const owner = ownerUserId()
    if (!owner) throw new WecomCliError("auth_required", "请先登录 Synapse。")
    return owner
  }

  function currentAttempt(definition: WecomMailDefinition): Attempt | undefined {
    const owner = ownerUserId()
    return owner ? attempts.get(attemptKey(owner, definition)) : undefined
  }

  function cancel(attempt: Attempt | undefined) {
    if (!attempt) return
    attempt.session?.cancel().catch(() => undefined)
    attempt.session = undefined
    attempt.qrCodeDataUrl = undefined
  }

  async function readBinding(owner: string, definition: WecomMailDefinition): Promise<WecomMailBindingV1 | undefined> {
    const state = await deps.state.getSingleton()
    return state?.bindings[attemptKey(owner, definition)]
  }

  async function writeBinding(owner: string, definition: WecomMailDefinition, account: WecomCliAccount): Promise<WecomMailBindingV1> {
    const current = await deps.state.getSingleton() ?? { schemaVersion: 1 as const, bindings: {} }
    const timestamp = new Date(now()).toISOString()
    const binding: WecomMailBindingV1 = {
      ownerUserId: owner,
      connectorId: definition.id,
      address: account.address,
      displayName: account.displayName,
      connectedAt: current.bindings[attemptKey(owner, definition)]?.connectedAt ?? timestamp,
      lastValidatedAt: timestamp,
    }
    await deps.state.setSingleton({
      ...current,
      bindings: { ...current.bindings, [attemptKey(owner, definition)]: binding },
    })
    return binding
  }

  async function removeBinding(owner: string, definition: WecomMailDefinition): Promise<void> {
    const current = await deps.state.getSingleton()
    if (!current) return
    const next = { ...current.bindings }
    delete next[attemptKey(owner, definition)]
    await deps.state.setSingleton({ ...current, bindings: next })
  }

  function itemFromAttempt(
    definition: WecomMailDefinition,
    attempt: Attempt | undefined,
    binding?: WecomMailBindingV1,
  ): ConnectorItem {
    const status = attempt?.status ?? (binding ? "connected" : "disconnected")
    const account = attempt?.account ?? binding
    return {
      id: definition.id,
      kind: "wecom-mail",
      name: definition.name,
      description: definition.description,
      documentationUrl: definition.documentationUrl,
      enabled: ["connecting", "verifying", "connected"].includes(status),
      probeStatus: status === "connected"
        ? "ready"
        : ["connecting", "verifying"].includes(status)
          ? "checking"
          : ["failed", "reconnect_required"].includes(status)
            ? "error"
            : "idle",
      connectionStatus: status,
      canRetry: status === "failed" || status === "reconnect_required",
      ...(attempt?.qrCodeDataUrl ? { qrCodeDataUrl: attempt.qrCodeDataUrl } : {}),
      ...(account ? {
        mailbox: {
          address: account.address,
          displayName: account.displayName,
          connectedAt: binding?.connectedAt ?? new Date(now()).toISOString(),
          lastValidatedAt: binding?.lastValidatedAt ?? new Date(now()).toISOString(),
        },
      } : {}),
      ...(attempt?.errorMessage ? { errorMessage: attempt.errorMessage } : {}),
      ...(attempt?.warningMessage ? { warningMessage: attempt.warningMessage } : {}),
      ...(attempt?.helpUrl ? { helpUrl: attempt.helpUrl } : {}),
    }
  }

  function applyAccount(attempt: Attempt, account: WecomCliAccount): void {
    attempt.account = account
    attempt.warningMessage = account.warningMessage
    attempt.helpUrl = account.helpUrl
    attempt.errorMessage = undefined
    attempt.status = "connected"
  }

  async function item(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    const typed = requireDefinition(definition)
    const owner = ownerUserId()
    const attempt = currentAttempt(typed)
    const binding = owner ? await readBinding(owner, typed) : undefined
    return itemFromAttempt(typed, attempt, binding)
  }

  async function connect(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    const typed = requireDefinition(definition)
    const owner = requireOwner()
    restoredOwner = owner
    const previous = currentAttempt(typed)
    if (previous?.session) {
      const session = previous.session
      previous.session = undefined
      await session.cancel()
    }
    cancel(previous)

    let authorized: boolean
    try {
      authorized = await deps.client.isAuthorized(owner)
    } catch (error) {
      const attempt: Attempt = {
        ownerUserId: owner,
        generation: `${now()}-${Math.random()}`,
        status: "failed",
        errorMessage: errorMessage(error),
        helpUrl: errorHelpUrl(error),
      }
      attempts.set(attemptKey(owner, typed), attempt)
      notify()
      throw error
    }

    if (authorized) {
      const binding = await readBinding(owner, typed)
      const attempt: Attempt = {
        ownerUserId: owner,
        generation: `${now()}-${Math.random()}`,
        status: "verifying",
        account: binding ? { address: binding.address, displayName: binding.displayName } : undefined,
      }
      attempts.set(attemptKey(owner, typed), attempt)
      notify()
      try {
        const account = await deps.client.validate(owner)
        if (attempts.get(attemptKey(owner, typed)) !== attempt) return itemFromAttempt(typed, attempt, binding)
        await writeBinding(owner, typed, account)
        applyAccount(attempt, account)
        notify()
        return itemFromAttempt(typed, attempt, await readBinding(owner, typed))
      } catch (error) {
        if (attempts.get(attemptKey(owner, typed)) !== attempt) return itemFromAttempt(typed, attempt, binding)
        if (error instanceof WecomCliError && error.code === "auth_required") {
          attempts.delete(attemptKey(owner, typed))
        } else {
          attempt.status = "failed"
          attempt.errorMessage = errorMessage(error)
          attempt.helpUrl = errorHelpUrl(error)
          notify()
          return itemFromAttempt(typed, attempt, binding)
        }
      }
    }

    await removeBinding(owner, typed)

    const attempt: Attempt = {
      ownerUserId: owner,
      generation: `${now()}-${Math.random()}`,
      status: "connecting",
    }
    attempts.set(attemptKey(owner, typed), attempt)
    notify()

    try {
      const session = await deps.client.startAuth(owner)
      attempt.session = session
      attempt.qrCodeDataUrl = session.qrCodeDataUrl
      notify()

      void session.wait()
        .then(async () => {
          if (attempts.get(attemptKey(owner, typed)) !== attempt) return
          attempt.status = "verifying"
          attempt.qrCodeDataUrl = undefined
          notify()
          const account = await deps.client.validate(owner)
          if (attempts.get(attemptKey(owner, typed)) !== attempt) return
          await writeBinding(owner, typed, account)
          applyAccount(attempt, account)
          attempt.session = undefined
          notify()
        })
        .catch((error: unknown) => {
          if (attempts.get(attemptKey(owner, typed)) !== attempt) return
          attempt.status = error instanceof WecomCliError && error.code === "auth_required"
            ? "reconnect_required"
            : "failed"
          attempt.errorMessage = errorMessage(error)
          attempt.helpUrl = errorHelpUrl(error)
          attempt.session = undefined
          attempt.qrCodeDataUrl = undefined
          notify()
        })
    } catch (error) {
      attempt.status = "failed"
      attempt.errorMessage = errorMessage(error)
      attempt.helpUrl = errorHelpUrl(error)
      attempt.session = undefined
      attempt.qrCodeDataUrl = undefined
      notify()
      throw error
    }

    return itemFromAttempt(typed, attempt)
  }

  async function disconnect(definition: BuiltinConnectorDefinition): Promise<void> {
    const typed = requireDefinition(definition)
    const owner = ownerUserId()
    if (!owner) return
    const attempt = currentAttempt(typed)
    if (attempt?.session) {
      const session = attempt.session
      attempt.session = undefined
      await session.cancel()
    }
    cancel(attempt)
    attempts.delete(attemptKey(owner, typed))
    await deps.client.disconnect(owner)
    await removeBinding(owner, typed)
    notify()
  }

  async function retry(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    return connect(definition)
  }

  function invalidate(): void {
    for (const attempt of attempts.values()) cancel(attempt)
    attempts.clear()
    restoredOwner = null
    notify()
  }

  async function restoreDefinition(definition: BuiltinConnectorDefinition): Promise<void> {
    const typed = requireDefinition(definition)
    const owner = ownerUserId()
    if (!owner) return
    restoredOwner = owner
    const key = attemptKey(owner, typed)
    if (restoring.has(key) || currentAttempt(typed)) return
    restoring.add(key)
    try {
      const binding = await readBinding(owner, typed)
      if (!binding) return
      const existing = attempts.get(key)
      if (existing?.status === "connected" || existing?.status === "verifying" || existing?.status === "connecting") return
      const attempt: Attempt = {
        ownerUserId: owner,
        generation: `${now()}-${Math.random()}`,
        status: "verifying",
        account: { address: binding.address, displayName: binding.displayName },
      }
      attempts.set(key, attempt)
      notify()
      try {
        const account = await deps.client.validate(owner)
        if (attempts.get(key) !== attempt) return
        await writeBinding(owner, typed, account)
        applyAccount(attempt, account)
      } catch (error) {
        if (attempts.get(key) !== attempt) return
        attempt.status = error instanceof WecomCliError && error.code === "auth_required"
          ? "reconnect_required"
          : "failed"
        attempt.errorMessage = errorMessage(error)
        attempt.helpUrl = errorHelpUrl(error)
      }
      notify()
    } finally {
      restoring.delete(key)
    }
  }

  async function requireConnected(definition: BuiltinConnectorDefinition): Promise<{ owner: string; typed: WecomMailDefinition }> {
    const typed = requireDefinition(definition)
    const owner = requireOwner()
    const attempt = currentAttempt(typed)
    if (!attempt || attempt.status !== "connected") {
      throw new WecomCliError("auth_required", "请先连接企业微信邮箱。")
    }
    return { owner, typed }
  }

  function clearMailWarning(typed: WecomMailDefinition): void {
    const attempt = currentAttempt(typed)
    if (!attempt?.warningMessage && !attempt?.helpUrl) return
    attempt.warningMessage = undefined
    attempt.helpUrl = undefined
    notify()
  }

  function applyMailPermissionError(typed: WecomMailDefinition, error: unknown): void {
    if (!(error instanceof WecomCliError) || error.code !== "permission_denied") return
    const attempt = currentAttempt(typed)
    if (!attempt) return
    attempt.warningMessage = error.message
    attempt.helpUrl = error.helpUrl
    notify()
  }

  const driver: ConnectorDriver = {
    probe: async (definition): Promise<ProbeResult> => {
      const typed = requireDefinition(definition)
      const attempt = currentAttempt(typed)
      return attempt?.status === "connected"
        ? { ok: true, toolCount: 0 }
        : { ok: false, errorCode: "permission_denied" }
    },
    createAgentContribution: () => ({ mcpServers: [], skillPackageIds: [] }),
    mail: {
      async search(definition, input: WecomMailSearchInput): Promise<WecomMailSearchResult> {
        const { owner, typed } = await requireConnected(definition)
        try {
          const result = await deps.client.search(owner, input)
          clearMailWarning(typed)
          return result
        } catch (error) {
          applyMailPermissionError(typed, error)
          throw error
        }
      },
      async get(definition, input: WecomMailGetInput): Promise<WecomMailDetail> {
        const { owner, typed } = await requireConnected(definition)
        try {
          const result = await deps.client.get(owner, input)
          clearMailWarning(typed)
          return result
        } catch (error) {
          applyMailPermissionError(typed, error)
          throw error
        }
      },
      async send(definition, input: WecomMailSendInput): Promise<WecomMailSendResult> {
        const { owner } = await requireConnected(definition)
        return deps.client.send(owner, input)
      },
    },
    lifecycle: {
      async initialize(onChanged) {
        notify = onChanged
        unsubscribe = [
          deps.account.onBeforeIdentityChange(() => { invalidate() }),
          deps.account.onStateChanged(() => {
            if (ownerUserId() !== restoredOwner) invalidate()
            else notify()
          }),
        ]
      },
      async item(definition) {
        const typed = requireDefinition(definition)
        const owner = ownerUserId()
        if (owner && !currentAttempt(typed)) void restoreDefinition(typed)
        return item(definition)
      },
      connect,
      disconnect,
      retry,
      dispose() {
        unsubscribe.forEach((fn) => fn())
        unsubscribe = []
        invalidate()
      },
    },
  }
  return driver
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "企业微信邮箱操作失败，请重试。"
}

function errorHelpUrl(error: unknown): string | undefined {
  return error instanceof WecomCliError ? error.helpUrl : undefined
}
