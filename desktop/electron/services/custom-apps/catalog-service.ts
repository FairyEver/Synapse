import {
  customAppSnapshotSchema,
  customAppsClientStateSchema,
  type CustomAppCreateInput,
  type CustomAppDockOperation,
  type CustomAppId,
  type CustomAppSnapshotDto,
  type CustomAppUpdateInput,
  type CustomAppsClientState,
} from "@synapse/shared/custom-apps-contracts"
import type { DataRepository } from "../../runtime/data-repo"
import type { EventBus } from "../../runtime/event-bus"
import {
  CUSTOM_APPS_SNAPSHOT_NAMESPACE,
  type CustomAppsSnapshotEntryV1,
} from "../../runtime/data-repo/schemas/custom-apps"
import {
  CustomAppsAuthenticationError,
  CustomAppsHttpApi,
  customAppsHttpStatus,
  type CustomAppsAccountPort,
  type CustomAppsApiPort,
} from "./mutation-service"

export type { CustomAppsAccountPort, CustomAppsApiPort } from "./mutation-service"

export const CUSTOM_APPS_SERVICE_ID = "core.custom-apps"

export type { CustomAppsClientState, CustomAppsSyncState } from "@synapse/shared/custom-apps-contracts"

type CustomAppsCatalogDependencies = {
  readonly account: CustomAppsAccountPort
  readonly repository: Pick<DataRepository, "namespace">
  readonly api?: CustomAppsApiPort
  readonly eventBus?: Pick<EventBus, "emit" | "onType">
  readonly now?: () => Date
}

export class CustomAppsCatalogService {
  private readonly account: CustomAppsAccountPort
  private readonly snapshots: CustomAppsSnapshotEntryV1Namespace
  private readonly api: CustomAppsApiPort
  private readonly eventBus?: Pick<EventBus, "emit" | "onType">
  private readonly now: () => Date
  private readonly listeners = new Set<(state: CustomAppsClientState) => void>()
  private unsubscribeAccount: (() => void) | null = null
  private unsubscribeLive: (() => void) | null = null
  private unsubscribeLiveState: (() => void) | null = null
  private liveConnected = false
  private state: CustomAppsClientState = signedOutState()
  private refreshGeneration = 0
  private refreshInFlight: Promise<void> | null = null
  private refreshInFlightKey: string | null = null

  constructor(deps: CustomAppsCatalogDependencies) {
    this.account = deps.account
    this.snapshots = deps.repository.namespace<CustomAppsSnapshotEntryV1>(
      CUSTOM_APPS_SNAPSHOT_NAMESPACE,
    ) as CustomAppsSnapshotEntryV1Namespace
    this.api = deps.api ?? new CustomAppsHttpApi(deps.account)
    this.eventBus = deps.eventBus
    this.now = deps.now ?? (() => new Date())
  }

  async initialize(): Promise<void> {
    this.unsubscribeAccount ??= this.account.onStateChanged(() => {
      void this.refresh("account-change")
    })
    this.unsubscribeLive ??= this.eventBus?.onType("account", "custom-apps.revision", (event) => {
      const revision = typeof event.payload === "object" && event.payload !== null
        && "revision" in event.payload
        && typeof event.payload.revision === "number"
        && Number.isInteger(event.payload.revision)
        && event.payload.revision >= 0
        ? event.payload.revision
        : null
      if (revision !== null) void this.handleLiveRevision(revision)
    }) ?? null
    this.unsubscribeLiveState ??= this.eventBus?.onType("live", "live.stateChanged", (event) => {
      const status = typeof event.payload === "object" && event.payload !== null
        && "status" in event.payload
        && typeof event.payload.status === "string"
        ? event.payload.status
        : null
      const connected = status === "connected"
      if (connected && !this.liveConnected) void this.refresh("live-reconnect")
      this.liveConnected = connected
    }) ?? null
    await this.refresh("startup")
  }

  dispose(): void {
    this.refreshGeneration += 1
    this.unsubscribeAccount?.()
    this.unsubscribeAccount = null
    this.unsubscribeLive?.()
    this.unsubscribeLive = null
    this.unsubscribeLiveState?.()
    this.unsubscribeLiveState = null
    this.liveConnected = false
    this.listeners.clear()
  }

  getState(): CustomAppsClientState {
    return this.state
  }

  subscribe(listener: (state: CustomAppsClientState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async seedCache(accountId: string, snapshot: CustomAppSnapshotDto): Promise<void> {
    const validated = customAppSnapshotSchema.parse(snapshot)
    await this.snapshots.upsert({
      id: accountId,
      schemaVersion: 1,
      accountId,
      cachedAt: this.now().toISOString(),
      snapshot: validated,
    })
  }

  async refresh(_reason: string): Promise<void> {
    const generation = ++this.refreshGeneration
    const accountState = this.account.getState()
    if (accountState.status !== "authenticated") {
      this.setState(signedOutState())
      return
    }

    const accountId = accountState.profile.user.id
    if (this.state.accountId !== accountId) {
      this.setState({
        accountId,
        snapshot: null,
        syncState: "loading",
        errorCode: null,
      })
    }
    const cached = await this.readCache(accountId)
    if (!this.isCurrentAccount(accountId, generation)) return
    this.setState({
      accountId,
      snapshot: cached?.snapshot ?? null,
      syncState: "loading",
      errorCode: null,
    })

    if (accountState.connectivity === "offline") {
      this.setState({
        accountId,
        snapshot: cached?.snapshot ?? null,
        syncState: "offline",
        errorCode: "offline",
      })
      return
    }

    const scope = this.account.captureAccountRequestScope()
    if (!scope) {
      this.setState({
        accountId,
        snapshot: cached?.snapshot ?? null,
        syncState: "offline",
        errorCode: "offline",
      })
      return
    }

    const refreshKey = `${accountId}:${scope.authRevision}`
    if (!this.refreshInFlight || this.refreshInFlightKey !== refreshKey) {
      const task = this.fetchAndCommit(accountId, scope.authRevision, generation, cached?.snapshot ?? null)
        .finally(() => {
          if (this.refreshInFlight === task) {
            this.refreshInFlight = null
            this.refreshInFlightKey = null
          }
        })
      this.refreshInFlight = task
      this.refreshInFlightKey = refreshKey
    }
    await this.refreshInFlight
  }

  async handleLiveRevision(revision: number): Promise<void> {
    if (!this.state.snapshot || revision <= this.state.snapshot.revision) return
    await this.refresh("live")
  }

  async create(input: CustomAppCreateInput): Promise<CustomAppSnapshotDto> {
    return this.mutate(() => this.api.create(input))
  }

  async update(id: CustomAppId, input: CustomAppUpdateInput): Promise<CustomAppSnapshotDto> {
    return this.mutate(() => this.api.update(id, input))
  }

  async delete(id: CustomAppId, operationId: string): Promise<CustomAppSnapshotDto> {
    return this.mutate(() => this.api.delete(id, operationId))
  }

  async bootstrapDock(input: {
    readonly operationId: string
    readonly dockAppIds: string[]
    readonly dockMigrationIds: string[]
  }): Promise<CustomAppSnapshotDto> {
    return this.mutate(() => this.api.bootstrap(input))
  }

  async applyDockOperation(operation: CustomAppDockOperation): Promise<CustomAppSnapshotDto> {
    return this.mutate(() => this.api.applyDockOperation(operation))
  }

  private async fetchAndCommit(
    accountId: string,
    authRevision: number,
    generation: number,
    cached: CustomAppSnapshotDto | null,
  ): Promise<void> {
    try {
      const snapshot = await this.api.fetchSnapshot()
      if (!this.isCurrent(accountId, authRevision, generation)) return
      const validated = customAppSnapshotSchema.parse(snapshot)
      if (!this.shouldAcceptSnapshot(accountId, validated)) return
      await this.writeCache(accountId, validated)
      if (!this.isCurrent(accountId, authRevision, generation)) return
      if (!this.shouldAcceptSnapshot(accountId, validated)) return
      this.setState(customAppsClientStateSchema.parse({
        accountId,
        snapshot: validated,
        syncState: "ready",
        errorCode: null,
      }))
    } catch (error) {
      if (!this.isCurrent(accountId, authRevision, generation)) return
      const status = customAppsHttpStatus(error)
      const currentAccount = this.account.getState()
      const offline = currentAccount.status === "authenticated"
        && currentAccount.connectivity === "offline"
      const fallback = this.state.accountId === accountId
        && this.state.snapshot
        && (!cached || this.state.snapshot.revision >= cached.revision)
        ? this.state.snapshot
        : cached
      this.setState({
        accountId,
        snapshot: fallback,
        syncState: status === 404 ? "unsupported" : offline ? "offline" : "error",
        errorCode: status === 404
          ? "unsupported"
          : error instanceof CustomAppsAuthenticationError ? "not_authenticated" : "sync_failed",
      })
    }
  }

  private async mutate(run: () => Promise<CustomAppSnapshotDto>): Promise<CustomAppSnapshotDto> {
    if (this.state.syncState !== "ready" || !this.state.accountId) {
      throw new Error("自定义应用配置当前不可编辑。")
    }
    const accountId = this.state.accountId
    const scope = this.account.captureAccountRequestScope()
    if (!scope || scope.accountId !== accountId) throw new CustomAppsAuthenticationError()
    const snapshot = customAppSnapshotSchema.parse(await run())
    const currentSnapshot = this.state.accountId === accountId ? this.state.snapshot : null
    const nextSnapshot = currentSnapshot && currentSnapshot.revision > snapshot.revision
      ? currentSnapshot
      : snapshot
    if (!this.isCurrentMutationAccount(accountId, scope.authRevision)) {
      throw new CustomAppsAuthenticationError()
    }
    await this.writeCache(accountId, nextSnapshot)
    if (!this.isCurrentMutationAccount(accountId, scope.authRevision)) {
      throw new CustomAppsAuthenticationError()
    }
    this.setState({
      accountId,
      snapshot: nextSnapshot,
      syncState: "ready",
      errorCode: null,
    })
    return nextSnapshot
  }

  private isCurrent(accountId: string, authRevision: number, generation: number): boolean {
    const accountState = this.account.getState()
    const scope = this.account.captureAccountRequestScope()
    return generation === this.refreshGeneration
      && accountState.status === "authenticated"
      && accountState.profile.user.id === accountId
      && scope?.authRevision === authRevision
  }

  private isCurrentAccount(accountId: string, generation: number): boolean {
    const accountState = this.account.getState()
    return generation === this.refreshGeneration
      && accountState.status === "authenticated"
      && accountState.profile.user.id === accountId
  }

  private isCurrentMutationAccount(accountId: string, authRevision: number): boolean {
    const accountState = this.account.getState()
    const scope = this.account.captureAccountRequestScope()
    return accountState.status === "authenticated"
      && accountState.profile.user.id === accountId
      && scope?.authRevision === authRevision
  }

  private shouldAcceptSnapshot(accountId: string, snapshot: CustomAppSnapshotDto): boolean {
    if (this.state.accountId !== accountId || !this.state.snapshot) return true
    return snapshot.revision >= this.state.snapshot.revision
  }

  private async readCache(accountId: string): Promise<CustomAppsSnapshotEntryV1 | null> {
    try {
      const entry = await this.snapshots.get(accountId)
      if (entry?.accountId !== accountId) return null
      return {
        ...entry,
        snapshot: customAppSnapshotSchema.parse(entry.snapshot),
      }
    } catch {
      return null
    }
  }

  private async writeCache(accountId: string, snapshot: CustomAppSnapshotDto): Promise<void> {
    try {
      await this.snapshots.upsert({
        id: accountId,
        schemaVersion: 1,
        accountId,
        cachedAt: this.now().toISOString(),
        snapshot,
      })
    } catch {
      // Rendering the last live snapshot remains valid even if local persistence fails.
    }
  }

  private setState(next: CustomAppsClientState): void {
    this.state = next
    for (const listener of this.listeners) listener(next)
    this.eventBus?.emit({
      domain: "account",
      type: "custom-apps.changed",
      payload: next,
      timestamp: this.now().toISOString(),
    })
  }
}

type CustomAppsSnapshotEntryV1Namespace = {
  get(id: string): Promise<CustomAppsSnapshotEntryV1 | null>
  upsert(value: CustomAppsSnapshotEntryV1): Promise<void>
}

function signedOutState(): CustomAppsClientState {
  return {
    accountId: null,
    snapshot: null,
    syncState: "signed-out",
    errorCode: null,
  }
}
