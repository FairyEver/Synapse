import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { ConnectorCredentialEntryV1, ConnectorStateStoreV1, PortalConnectionBindingV1 } from "../../../electron/runtime/data-repo/schemas/connectors"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import type { SynapseAccountState } from "../../../src/types/account"
import { parsePortalCallback, portalTokenSchema } from "../shared/portal-contract"
import type { ConnectorItem } from "../shared/schema"
import { PortalConnectionError, portalErrors, type PortalErrorCode } from "./portal-errors"
import type { PortalCredentialInput, PortalVerifier } from "./portal-verifier"
import type { BuiltinConnectorDefinition, ConnectorDriver, PortalIntegration } from "./types"

type PortalDefinition = BuiltinConnectorDefinition & { integration: PortalIntegration }
type Attempt = {
  key: string; ownerUserId: string; definition: PortalDefinition; controller: AbortController
  status: NonNullable<ConnectorItem["connectionStatus"]>; state?: string; expiresAt?: number
  timer?: ReturnType<typeof setTimeout>; errorCode?: PortalErrorCode
  pending?: PortalCredentialInput; binding?: PortalConnectionBindingV1
}
export type PortalSessionDriverDeps = {
  definitions: readonly BuiltinConnectorDefinition[]
  state: DataNamespace<ConnectorStateStoreV1>
  credentials: DataNamespace<ConnectorCredentialEntryV1>
  account: {
    getState(): SynapseAccountState
    onBeforeIdentityChange(listener: () => void | Promise<void>): () => void
    onStateChanged(listener: (state: SynapseAccountState) => void): () => void
  }
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  openExternal(url: string, signal?: AbortSignal): Promise<void>
  verify: PortalVerifier
  now?: () => number
  secureStorageAvailable?: () => boolean
}
export function portalBindingKey(ownerUserId: string, definition: PortalDefinition): string {
  return `portal:${createHash("sha256").update(JSON.stringify([ownerUserId, definition.integration.environmentId, definition.id])).digest("hex")}`
}
const retryable = new Set<PortalErrorCode>(["network_error", "verification_timeout", "invalid_response"])
const reconnect = new Set<PortalErrorCode>(["credential_invalid", "tenant_unavailable", "tenant_mismatch", "identity_mismatch"])

export function createPortalSessionDriver(deps: PortalSessionDriverDeps) {
  const definitions = deps.definitions.filter((d): d is PortalDefinition => d.integration.kind === "portal-session")
  const attempts = new Map<string, Attempt>()
  const now = deps.now ?? Date.now
  let notify = () => undefined as void
  let queue: Promise<unknown> = Promise.resolve()
  let unsubscribe: (() => void)[] = []
  let restoredOwner: string | null = null
  function owner(): string | null {
    const state = deps.account.getState()
    return state.status === "authenticated" && state.profile.user.status === "active" ? state.profile.user.id : null
  }
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run)
    queue = result.catch(() => undefined)
    return result
  }
  function current(attempt: Attempt): boolean {
    return attempts.get(attempt.key) === attempt && owner() === attempt.ownerUserId && !attempt.controller.signal.aborted
  }
  function assertCurrent(attempt: Attempt): void {
    if (!current(attempt)) throw new PortalConnectionError("cancelled")
  }
  function cancel(attempt: Attempt): void {
    attempt.controller.abort()
    clearTimeout(attempt.timer)
    attempt.state = undefined
    attempt.pending = undefined
  }
  function makeAttempt(definition: PortalDefinition): Attempt {
    const ownerUserId = owner()
    if (!ownerUserId) throw new PortalConnectionError("login_required")
    const key = portalBindingKey(ownerUserId, definition)
    const previous = attempts.get(key)
    if (previous) cancel(previous)
    const attempt: Attempt = { key, ownerUserId, definition, controller: new AbortController(), status: "disconnected" }
    attempts.set(key, attempt)
    return attempt
  }
  function audit(event: Parameters<AuditSink["record"]>[0]): void {
    try { deps.auditSink.record(event) }
    catch { throw new PortalConnectionError("permission_denied") }
  }
  async function guarded<T>(action: PermissionAction, resource: string, run: () => Promise<T>): Promise<T> {
    const actor = { kind: "user" as const }
    let allowed = false
    try {
      const permission = await deps.permissionGuard.check({ action, actor, resource, context: { source: "connectors.portal" } })
      if (!permission.allowed) throw new PortalConnectionError("permission_denied")
      allowed = true
      if (action.startsWith("secret.") && deps.secureStorageAvailable?.() === false) throw new PortalConnectionError("storage_error")
      const result = await run()
      audit({ action, actor, resource, outcome: "allowed", metadata: { source: "connectors.portal" } })
      return result
    } catch (error) {
      audit({ action, actor, resource, outcome: allowed ? "failed" : "denied", metadata: { source: "connectors.portal" } })
      if (error instanceof PortalConnectionError) throw error
      throw new PortalConnectionError(action.startsWith("secret.") ? "storage_error" : "network_error")
    }
  }
  const readCredential = (id: string) => guarded("secret.read", "app.connectors.credentials", () => deps.credentials.get(id))
  const removeCredential = (id: string) => guarded("secret.write", "app.connectors.credentials", () => deps.credentials.remove(id))
  function matches(binding: { ownerUserId: string; environmentId: string; connectorId: string }, attempt: Attempt): boolean {
    return binding.ownerUserId === attempt.ownerUserId && binding.environmentId === attempt.definition.integration.environmentId && binding.connectorId === attempt.definition.id
  }
  async function readBinding(attempt: Attempt): Promise<PortalConnectionBindingV1 | undefined> {
    const binding = (await deps.state.get(attempt.key))?.portalBinding
    if (binding && !matches(binding, attempt)) throw new PortalConnectionError("storage_error")
    return binding
  }
  async function writeBinding(attempt: Attempt, binding: PortalConnectionBindingV1): Promise<void> {
    await deps.state.upsert({ id: attempt.key, schemaVersion: 1, connectors: {}, portalBinding: binding })
  }
  async function clearBinding(attempt: Attempt): Promise<void> {
    const binding = await readBinding(attempt)
    if (binding) {
      // Persist the tombstone before deletion so failed cleanup can never restore a connection.
      await writeBinding(attempt, { ...binding, enabled: false })
      await removeCredential(binding.credentialRef)
      await deps.state.remove(attempt.key)
    }
    // Recover a crash between writing a new credential and committing its reference.
    const records = await guarded("secret.read", "app.connectors.credentials", () => deps.credentials.list())
    for (const entry of records) {
      if (entry.portal && matches(entry.portal, attempt)) await removeCredential(entry.id)
    }
    attempt.binding = undefined
  }
  function fail(attempt: Attempt, error: unknown): void {
    if (!current(attempt)) return
    attempt.errorCode = error instanceof PortalConnectionError ? error.code : "storage_error"
    attempt.status = reconnect.has(attempt.errorCode) ? "reconnect_required" : "failed"
    if (!retryable.has(attempt.errorCode)) attempt.pending = undefined
    notify()
  }
  async function item(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    const portal = requirePortal(definition)
    const userId = owner()
    const attempt = userId ? attempts.get(portalBindingKey(userId, portal)) : undefined
    const status = attempt?.status ?? "disconnected"
    const binding = attempt?.binding
    return {
      id: definition.id, name: definition.name,
      enabled: Boolean(attempt?.pending || binding?.enabled || ["connecting", "verifying", "connected"].includes(status)),
      probeStatus: status === "connected" ? "ready" : ["connecting", "verifying"].includes(status) ? "checking" : ["failed", "reconnect_required"].includes(status) ? "error" : "idle",
      connectionStatus: status,
      canRetry: Boolean(attempt?.errorCode && retryable.has(attempt.errorCode) && (attempt.pending || binding?.enabled)),
      ...(attempt?.errorCode ? { errorMessage: portalErrors[attempt.errorCode] } : {}),
      ...(status === "connected" && binding ? { account: {
        portalUserId: binding.portalUserId, tenantId: binding.tenantId, displayName: binding.displayName,
        tenantName: binding.tenantName, connectedAt: binding.connectedAt, lastValidatedAt: binding.lastValidatedAt,
      } } : {}),
    }
  }
  async function connect(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    const attempt = makeAttempt(requirePortal(definition))
    attempt.status = "connecting"
    notify()
    try {
      await serial(async () => { assertCurrent(attempt); await clearBinding(attempt); assertCurrent(attempt) })
      assertCurrent(attempt)
      attempt.state = randomBytes(32).toString("base64url")
      attempt.expiresAt = now() + 5 * 60_000
      attempt.timer = setTimeout(() => {
        if (!current(attempt) || !attempt.state) return
        attempt.state = undefined
        fail(attempt, new PortalConnectionError("attempt_expired"))
      }, 5 * 60_000)
      attempt.timer.unref?.()
      const url = new URL(attempt.definition.integration.authorizationUrl)
      const query = new URLSearchParams({ state: attempt.state, callback: attempt.definition.integration.callbackUrl,
        environment: attempt.definition.integration.environmentId, language: attempt.definition.integration.language })
      url.hash = `${url.hash}?${query}`
      try { await deps.openExternal(url.toString(), attempt.controller.signal) }
      catch { throw new PortalConnectionError("browser_failed") }
      assertCurrent(attempt)
    } catch (error) {
      clearTimeout(attempt.timer)
      attempt.state = undefined
      fail(attempt, error)
      if (current(attempt)) throw new PortalConnectionError(attempt.errorCode!)
    }
    return item(definition)
  }
  async function validate(attempt: Attempt, credential: PortalCredentialInput): Promise<void> {
    attempt.status = "verifying"
    attempt.errorCode = undefined
    attempt.pending = credential
    notify()
    try {
      const profile = await guarded("network.connect", attempt.definition.integration.baseUrl, () => {
        assertCurrent(attempt)
        return deps.verify(attempt.definition.integration, credential, attempt.controller.signal)
      })
      assertCurrent(attempt)
      if (profile.portalUserId !== credential.portalUserId || profile.tenantId !== credential.tenantId) throw new PortalConnectionError("identity_mismatch")
      await serial(async () => {
        assertCurrent(attempt)
        const timestamp = new Date(now()).toISOString()
        const credentialRef = attempt.binding?.credentialRef ?? randomUUID()
        const binding: PortalConnectionBindingV1 = {
          ownerUserId: attempt.ownerUserId, connectorId: attempt.definition.id, environmentId: attempt.definition.integration.environmentId,
          tenantId: profile.tenantId, portalUserId: profile.portalUserId,
          displayName: profile.displayName, tenantName: profile.tenantName,
          enabled: true, credentialRef, connectedAt: attempt.binding?.connectedAt ?? timestamp, lastValidatedAt: timestamp,
        }
        try {
          await guarded("secret.write", "app.connectors.credentials", async () => {
            assertCurrent(attempt)
            await deps.credentials.upsert({ id: credentialRef, schemaVersion: 1, accessToken: credential.token,
              portal: { ownerUserId: binding.ownerUserId, connectorId: binding.connectorId, environmentId: binding.environmentId,
                tenantId: binding.tenantId, portalUserId: binding.portalUserId }, updatedAt: timestamp })
          })
          assertCurrent(attempt)
          await writeBinding(attempt, binding)
          assertCurrent(attempt)
          attempt.binding = binding
        } catch {
          // A durable disabled reference also makes partial writes safe across restart.
          await writeBinding(attempt, { ...binding, enabled: false })
          await removeCredential(credentialRef)
          throw new PortalConnectionError("storage_error")
        }
      })
      assertCurrent(attempt)
      attempt.pending = undefined
      attempt.status = "connected"
      notify()
    } catch (error) { fail(attempt, error) }
  }
  async function handleCallback(raw: string): Promise<void> {
    const definition = definitions.find((entry) => {
      try { return new URL(raw).hostname === new URL(entry.integration.callbackUrl).hostname } catch { return false }
    })
    if (!definition) throw new PortalConnectionError("invalid_callback")
    const callback = parsePortalCallback(raw, definition.integration.callbackUrl)
    const userId = owner()
    const attempt = userId ? attempts.get(portalBindingKey(userId, definition)) : undefined
    if (!attempt || !current(attempt) || !attempt.state || attempt.state !== callback.state) throw new PortalConnectionError("invalid_callback")
    const expired = now() >= (attempt.expiresAt ?? 0)
    attempt.state = undefined // consume before any await, including cancellation and error callbacks
    clearTimeout(attempt.timer)
    if (expired) { fail(attempt, new PortalConnectionError("attempt_expired")); throw new PortalConnectionError("attempt_expired") }
    if (callback.status === "cancelled") { attempt.status = "disconnected"; notify(); return }
    if (callback.status === "error") {
      fail(attempt, new PortalConnectionError(callback.errorCode === "request_expired" ? "attempt_expired" : callback.errorCode === "tenant_unavailable" ? "tenant_unavailable" : "authorization_failed"))
      return
    }
    await validate(attempt, { token: callback.token, tenantId: callback.tenantId, portalUserId: callback.portalUserId })
  }
  async function savedCredential(attempt: Attempt): Promise<PortalCredentialInput> {
    const binding = attempt.binding
    if (!binding?.enabled) throw new PortalConnectionError("credential_invalid")
    const credential = await readCredential(binding.credentialRef)
    assertCurrent(attempt)
    if (!credential?.portal || !portalTokenSchema.safeParse(credential.accessToken).success || !matches(credential.portal, attempt)
      || credential.portal.tenantId !== binding.tenantId || credential.portal.portalUserId !== binding.portalUserId) throw new PortalConnectionError("credential_invalid")
    return { token: credential.accessToken, tenantId: binding.tenantId, portalUserId: binding.portalUserId }
  }
  async function retry(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    const portal = requirePortal(definition)
    const userId = owner()
    const attempt = userId ? attempts.get(portalBindingKey(userId, portal)) : undefined
    if (!attempt || !current(attempt) || attempt.status !== "failed" || !attempt.errorCode || !retryable.has(attempt.errorCode)) throw new PortalConnectionError("invalid_callback")
    const pending = attempt.pending
    // Claim the retry before reading the encrypted credential (an asynchronous boundary).
    attempt.status = "verifying"
    attempt.errorCode = undefined
    notify()
    try { await validate(attempt, pending ?? await savedCredential(attempt)) }
    catch (error) { fail(attempt, error) }
    return item(definition)
  }
  async function disconnect(definition: BuiltinConnectorDefinition): Promise<void> {
    const attempt = makeAttempt(requirePortal(definition)) // synchronously invalidates any pending validation
    notify()
    try { await serial(() => clearBinding(attempt)) }
    catch { fail(attempt, new PortalConnectionError("storage_error")); throw new PortalConnectionError("storage_error") }
    notify()
  }
  async function restore(): Promise<void> {
    const userId = owner()
    if (!userId || restoredOwner === userId) return
    restoredOwner = userId
    await Promise.all(definitions.map(async (definition) => {
      const attempt = makeAttempt(definition)
      try {
        await serial(async () => {
          assertCurrent(attempt)
          attempt.binding = await readBinding(attempt)
          assertCurrent(attempt)
          if (!attempt.binding?.enabled) await clearBinding(attempt)
          else {
            const records = await guarded("secret.read", "app.connectors.credentials", () => deps.credentials.list())
            for (const entry of records) {
              if (entry.portal && matches(entry.portal, attempt) && entry.id !== attempt.binding.credentialRef) await removeCredential(entry.id)
            }
          }
        })
        if (attempt.binding?.enabled && current(attempt)) await validate(attempt, await savedCredential(attempt))
      } catch (error) { fail(attempt, error) }
    }))
  }
  function invalidate(): void {
    for (const attempt of attempts.values()) cancel(attempt)
    attempts.clear()
    restoredOwner = null
    notify()
  }
  const driver: ConnectorDriver = {
    probe: async () => ({ ok: false, errorCode: "invalid_endpoint" }),
    createAgentContribution: () => ({ mcpServers: [], skillPackageIds: [] }),
    lifecycle: {
      async initialize(onChanged) {
        notify = onChanged
        unsubscribe = [deps.account.onBeforeIdentityChange(() => { invalidate() }),
          deps.account.onStateChanged(() => {
            if (owner() !== restoredOwner) invalidate()
            void restore().catch(() => notify())
          })]
        // Never block app startup on Portal requests.
        void restore().catch(() => notify())
      },
      item, connect, disconnect, retry,
      dispose() { unsubscribe.forEach((fn) => fn()); unsubscribe = []; invalidate() },
    },
  }
  return {
    ...driver,
    handleCallback,
    async getSessionInput(connectorId: string) {
      const definition = definitions.find((entry) => entry.id === connectorId)
      const userId = owner()
      if (!definition || !userId) throw new PortalConnectionError("login_required")
      const attempt = attempts.get(portalBindingKey(userId, definition))
      if (!attempt || !current(attempt) || attempt.status !== "connected") throw new PortalConnectionError("credential_invalid")
      const credential = await savedCredential(attempt)
      assertCurrent(attempt)
      if (attempt.status !== "connected") throw new PortalConnectionError("credential_invalid")
      return { baseUrl: definition.integration.baseUrl, userId, language: definition.integration.language,
        credential: { token: credential.token, tenantId: credential.tenantId } }
    },
  }
}
function requirePortal(definition: BuiltinConnectorDefinition): PortalDefinition {
  if (definition.integration.kind !== "portal-session") throw new PortalConnectionError("invalid_callback")
  return definition as PortalDefinition
}
