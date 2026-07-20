import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseRepositoryConfig,
} from "@/types/config"
import type {
  SynapseContentMeta,
  SynapseContentChangedEvent,
  SynapseContentMutationResult,
  SynapseContentType,
  SynapseCreateContentPayload,
  SynapseCreateContentRequest,
  SynapseDeleteContentPayload,
  SynapseUpdateContentPayload,
  SynapseUpdateContentRequest,
} from "@/types/content"
import type {
  SynapseCreateLocalRepositoryPayload,
  SynapseCreateLocalRepositoryResult,
  SynapsePendingPushState,
  SynapsePendingPushUpdatedEvent,
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationOptions,
  SynapseRepositoryInitializationResult,
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
  SynapseRepositorySyncSnapshot,
  SynapseRepositorySyncSnapshotUpdatedEvent,
  SynapseRepositoryUpdatedEvent,
  SynapseRepositoryValidationResult,
} from "@/types/repository"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge, requireBridgeDomain } from "@/lib/electron-bridge"

export type RepositoryOperationState = {
  operation: SynapseRepositoryOperationKind | null
  isRunning: boolean
  statusText: string | null
  percent: number | null
  completedAt: string | null
  error?: string
}

export type RepositoryAddOptions = {
  activate?: boolean
}

type ContentSubscriber = () => void
type RepositorySubscriber = () => void
type OperationSubscriber = (state: RepositoryOperationState) => void

const EMPTY_REPOSITORIES: SynapseRepositoryConfig[] = []
const logger = createRendererLogger("app-shell.repository-manager")

class RepositoryManager {
  // ===== 配置状态 =====
  private config: SynapseConfig | null = null
  private isConfigReady = false

  // ===== 运行时状态 =====
  private repositoryStates: Map<string, SynapseRepositoryLocalState> = new Map()
  private operations: Map<string, RepositoryOperationState> = new Map()
  private pendingPushes: Map<string, SynapsePendingPushState> = new Map()
  private syncSnapshots: Map<string, SynapseRepositorySyncSnapshot> = new Map()

  // ===== 内容缓存 =====
  private contentCache: Map<SynapseContentType, SynapseContentMeta[]> = new Map()
  private contentLoading: Map<SynapseContentType, boolean> = new Map()
  private contentErrors: Map<SynapseContentType, Error | null> = new Map()
  private contentRefreshVersions: Map<SynapseContentType, number> = new Map()
  private contentSnapshots: Map<SynapseContentType, { items: SynapseContentMeta[]; isLoading: boolean; error: Error | null }> = new Map()

  // ===== 订阅者 =====
  private repositorySubscribers: Set<RepositorySubscriber> = new Set()
  private contentSubscribers: Map<SynapseContentType, Set<ContentSubscriber>> = new Map()
  private operationSubscribers: Map<string, Set<OperationSubscriber>> = new Map()

  // ===== Bridge 监听取消函数 =====
  private unsubscribeProgress: (() => void) | null = null
  private unsubscribeUpdated: (() => void) | null = null
  private unsubscribePendingPushes: (() => void) | null = null
  private unsubscribeSyncSnapshot: (() => void) | null = null
  private unsubscribeContentChanged: (() => void) | null = null

  // ===== 初始化 =====
  async initialize(): Promise<void> {
    await this.refreshConfig()
    this.setupBridgeListeners()
    await this.refreshRepositoryStates()
    await this.refreshPendingPushesForRepositories(this.getRepositories().map((repository) => repository.uuid))
    await this.refreshSyncSnapshots()

    // 初始化内容订阅者 Map
    for (const contentType of ["rule", "skill", "prompt"] as SynapseContentType[]) {
      this.contentSubscribers.set(contentType, new Set())
      this.contentLoading.set(contentType, false)
      this.contentErrors.set(contentType, null)
    }
  }

  destroy(): void {
    this.unsubscribeProgress?.()
    this.unsubscribeUpdated?.()
    this.unsubscribePendingPushes?.()
    this.unsubscribeSyncSnapshot?.()
    this.unsubscribeContentChanged?.()
  }

  // ===== 配置管理 =====
  getConfig(): SynapseConfig {
    if (!this.config) {
      throw new Error("RepositoryManager not initialized")
    }
    return this.config
  }

  getActiveRepository(): SynapseRepositoryConfig | null {
    if (!this.config) return null
    if (!this.config.activeRepoUuid) return null
    return (
      this.config.repositories.find((r) => r.uuid === this.config!.activeRepoUuid) ?? null
    )
  }

  getActiveRepositoryUuid(): string | null {
    return this.config?.activeRepoUuid ?? null
  }

  getRepositories(): SynapseRepositoryConfig[] {
    return this.config?.repositories ?? EMPTY_REPOSITORIES
  }

  hasRepositories(): boolean {
    return this.getRepositories().length > 0
  }

  isReady(): boolean {
    return this.isConfigReady
  }

  async refreshConfig(): Promise<void> {
    const bridge = requireBridgeDomain("config")

    this.config = await bridge.get()
    this.isConfigReady = true
    this.notifyRepositorySubscribers()
  }

  async updateConfig(patch: SynapseConfigPatch): Promise<void> {
    const bridge = requireBridgeDomain("config")

    this.config = await bridge.update(patch)
    this.notifyRepositorySubscribers()
  }

  async switchActiveRepository(uuid: string): Promise<void> {
    const repository = this.getRepositories().find((item) => item.uuid === uuid)

    if (!repository) {
      throw new Error("Repository not found")
    }

    if (this.getActiveRepositoryUuid() === uuid) {
      return
    }

    await this.setActiveRepository(uuid)
    this.resetContentForRepositoryChange()
    await this.refreshRepositoryStates()
    await this.refreshAllContent()
  }

  async setActiveRepository(uuid: string): Promise<void> {
    const repository = this.getRepositories().find((item) => item.uuid === uuid)

    if (!repository) {
      throw new Error("Repository not found")
    }

    await this.updateConfig({ activeRepoUuid: uuid })
    try {
      await this.refreshPendingPushes(uuid)
    } catch (error) {
      logger.warn("repository.pending-push-refresh-failed", { uuid, error: String(error) })
    }
  }

  async clearActiveRepository(): Promise<void> {
    if (!this.getActiveRepositoryUuid()) {
      return
    }

    await this.updateConfig({ activeRepoUuid: null })
    this.resetContentForRepositoryChange()
  }

  async addRepository(
    repository: SynapseRepositoryConfig,
    options: RepositoryAddOptions = {},
  ): Promise<void> {
    const currentActiveRepositoryUuid = this.getActiveRepositoryUuid()
    const repos = [...(this.config?.repositories ?? []), repository]
    const nextActiveRepositoryUuid =
      options.activate === true || !currentActiveRepositoryUuid
        ? repository.uuid
        : currentActiveRepositoryUuid
    const activeRepositoryChanged = currentActiveRepositoryUuid !== nextActiveRepositoryUuid

    await this.updateConfig({
      repositories: repos,
      activeRepoUuid: nextActiveRepositoryUuid,
    })
    await this.refreshRepositoryStates()
    await this.refreshPendingPushes(repository.uuid)
    await this.refreshSyncSnapshots()

    if (activeRepositoryChanged) {
      this.resetContentForRepositoryChange()
      await this.refreshAllContent()
    }
  }

  async removeRepository(uuid: string): Promise<void> {
    const repos = (this.config?.repositories ?? []).filter((r) => r.uuid !== uuid)
    const nextActiveRepoUuid = this.getActiveRepositoryUuid() === uuid
      ? null
      : this.getActiveRepositoryUuid()

    await this.replaceRepositories(repos, nextActiveRepoUuid)
  }

  async updateRepository(
    uuid: string,
    patch: Partial<SynapseRepositoryConfig>,
  ): Promise<void> {
    const isActiveRepository = this.getActiveRepositoryUuid() === uuid
    const contentSourceChanged = patch.localPath !== undefined || patch.contentDirs !== undefined

    const repos = (this.config?.repositories ?? []).map((r) =>
      r.uuid === uuid ? { ...r, ...patch } : r,
    )
    await this.updateConfig({ repositories: repos })
    await this.refreshRepositoryStates()

    if (isActiveRepository && contentSourceChanged) {
      this.resetContentForRepositoryChange()
    }

    if (isActiveRepository) {
      await this.refreshPendingPushes(uuid)
    }

    await this.refreshSyncSnapshots()

    if (isActiveRepository && contentSourceChanged) {
      await this.refreshAllContent()
    }
  }

  async replaceRepositories(
    repositories: SynapseRepositoryConfig[],
    activeRepoUuid: string | null,
  ): Promise<void> {
    const currentActiveRepository = this.getActiveRepository()
    const nextActiveRepoUuid =
      activeRepoUuid && repositories.some((repository) => repository.uuid === activeRepoUuid)
        ? activeRepoUuid
        : null
    const nextActiveRepository = nextActiveRepoUuid
      ? repositories.find((repository) => repository.uuid === nextActiveRepoUuid) ?? null
      : null
    const activeRepositoryChanged = this.getActiveRepositoryUuid() !== nextActiveRepoUuid
    const activeRepositoryContentSourceChanged =
      !activeRepositoryChanged
      && currentActiveRepository !== null
      && nextActiveRepository !== null
      && (
        currentActiveRepository.localPath !== nextActiveRepository.localPath
        || JSON.stringify(currentActiveRepository.contentDirs)
          !== JSON.stringify(nextActiveRepository.contentDirs)
      )

    await this.updateConfig({
      repositories,
      activeRepoUuid: nextActiveRepoUuid,
    })
    this.pruneRepositoryRuntimeState(new Set(repositories.map((repository) => repository.uuid)))
    await this.refreshRepositoryStates()

    if (activeRepositoryChanged || activeRepositoryContentSourceChanged) {
      this.resetContentForRepositoryChange()
    }

    if (nextActiveRepoUuid) {
      await this.refreshPendingPushes(nextActiveRepoUuid)
    }

    await this.refreshSyncSnapshots()

    if ((activeRepositoryChanged || activeRepositoryContentSourceChanged) && nextActiveRepoUuid) {
      await this.refreshAllContent()
    }
  }

  async createLocalRepositoryAndAdd(
    options: SynapseCreateLocalRepositoryPayload,
    addOptions: RepositoryAddOptions = { activate: true },
  ): Promise<SynapseCreateLocalRepositoryResult> {
    const result = await this.createLocalRepository(options)
    await this.addRepository(result.repository, addOptions)
    return result
  }

  // ===== 状态查询 =====
  getRepositoryState(uuid: string): SynapseRepositoryLocalState | undefined {
    return this.repositoryStates.get(uuid)
  }

  getOperationState(uuid: string): RepositoryOperationState | undefined {
    return this.operations.get(uuid)
  }

  getPendingPushes(uuid: string): SynapsePendingPushState | undefined {
    return this.pendingPushes.get(uuid)
  }

  getSyncSnapshot(uuid: string): SynapseRepositorySyncSnapshot | undefined {
    return this.syncSnapshots.get(uuid)
  }

  // ===== 公共访问器（供组件使用）=====
  getAllStates(): Map<string, SynapseRepositoryLocalState> {
    return this.repositoryStates
  }

  getAllOperations(): Map<string, RepositoryOperationState> {
    return this.operations
  }

  // ===== 仓库操作 =====
  async syncRepository(uuid: string): Promise<SynapseRepositoryOperationResult> {
    return this.runRepositoryOperation(uuid, "sync")
  }

  async pushRepository(uuid: string): Promise<SynapseRepositoryOperationResult> {
    return this.runRepositoryOperation(uuid, "push")
  }

  async initializeRepository(
    uuid: string,
    options?: SynapseRepositoryInitializationOptions,
  ): Promise<SynapseRepositoryInitializationResult> {
    const bridge = requireBridgeDomain("settings").repository

    this.setOperationState(uuid, {
      operation: "initialize",
      isRunning: true,
      statusText: "正在准备初始化...",
      percent: 0,
      completedAt: null,
    })

    try {
      const result = await bridge.initializeStructure(uuid, options)
      this.repositoryStates.set(uuid, result.repository)
      this.setOperationState(uuid, {
        operation: "initialize",
        isRunning: false,
        statusText: result.message ?? "初始化完成。",
        percent: 100,
        completedAt: result.initializedAt,
      })
      await this.refreshPendingPushes(uuid)
      this.notifyRepositorySubscribers()
      return result
    } catch (error) {
      this.setOperationState(uuid, {
        operation: "initialize",
        isRunning: false,
        statusText: null,
        percent: null,
        completedAt: null,
        error: error instanceof Error ? error.message : "初始化失败",
      })
      throw error
    }
  }

  async runMaintenance(uuid: string): Promise<SynapseRepositoryOperationResult> {
    return this.runRepositoryOperation(uuid, "maintenance")
  }

  private async runRepositoryOperation(
    uuid: string,
    operation: SynapseRepositoryOperationKind,
  ): Promise<SynapseRepositoryOperationResult> {
    const bridge = requireBridgeDomain("settings").repository

    this.setOperationState(uuid, {
      operation,
      isRunning: true,
      statusText: this.getPreparingStatusText(operation),
      percent: 0,
      completedAt: null,
    })

    try {
      let result: SynapseRepositoryOperationResult

      switch (operation) {
        case "sync":
          result = await bridge.sync(uuid)
          break
        case "push":
          result = await bridge.flushPendingPushes(uuid)
          break
        case "maintenance":
          result = await bridge.runMaintenance(uuid)
          break
        default:
          throw new Error(`Unknown operation: ${operation}`)
      }

      this.repositoryStates.set(uuid, result.repository)
      this.setOperationState(uuid, {
        operation,
        isRunning: false,
        statusText: result.message ?? this.getCompletedStatusText(operation),
        percent: 100,
        completedAt: result.completedAt,
      })

      // Post-operation refresh is best-effort — failure should not retroactively
      // mark the successful operation as failed.
      try {
        await this.refreshPendingPushes(uuid)
      } catch {
        logger.warn("repository.operation.pending-push-refresh-failed", { uuid, operation })
      }
      if (operation === "sync" && uuid === this.getActiveRepositoryUuid()) {
        try {
          await this.refreshAllContent()
        } catch {
          logger.warn("repository.operation.content-refresh-failed", { uuid, operation })
        }
      }
      this.notifyRepositorySubscribers()
      return result
    } catch (error) {
      this.setOperationState(uuid, {
        operation,
        isRunning: false,
        statusText: null,
        percent: null,
        completedAt: null,
        error: error instanceof Error ? error.message : "操作失败",
      })
      throw error
    }
  }

  // ===== 内容操作（自动刷新）=====
  async createContent<T extends SynapseContentType>(
    contentType: T,
    payload: SynapseCreateContentPayload<T>,
  ): Promise<SynapseContentMutationResult> {
    const bridge = requireBridgeDomain("resourceRepository")
    const t0 = Date.now()
    logger.info("createContent: calling bridge.create.", { contentType })

    const result = await bridge.item.create({ contentType, payload } as SynapseCreateContentRequest<T>)
    logger.info("createContent: bridge.create returned.", { contentType, durationMs: Date.now() - t0, status: result.status })

    if (result.status === "saved") {
      const t1 = Date.now()
      logger.info("createContent: calling refreshContentList.", { contentType })
      await this.refreshContentList(contentType)
      logger.info("createContent: refreshContentList done.", { contentType, durationMs: Date.now() - t1 })

      // 触发后台推送
      const activeRepo = this.getActiveRepository()
      if (activeRepo && result.pendingPushCount > 0) {
        logger.info("createContent: scheduling background push.", { repositoryUuid: activeRepo.uuid })
        this.scheduleBackgroundPush(activeRepo.uuid)
      }
    }

    logger.info("createContent: complete.", { contentType, totalDurationMs: Date.now() - t0 })
    return result
  }

  async updateContent<T extends SynapseContentType>(
    contentType: T,
    payload: SynapseUpdateContentPayload<T>,
  ): Promise<SynapseContentMutationResult> {
    const bridge = requireBridgeDomain("resourceRepository")

    const result = await bridge.item.update({ contentType, payload } as SynapseUpdateContentRequest<T>)

    if (result.status === "saved") {
      await this.refreshContentList(contentType)

      // 触发后台推送
      const activeRepo = this.getActiveRepository()
      if (activeRepo && result.pendingPushCount > 0) {
        this.scheduleBackgroundPush(activeRepo.uuid)
      }
    }

    return result
  }

  async deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult> {
    const bridge = requireBridgeDomain("resourceRepository")

    const result = await bridge.operation.deleteContent(payload)

    if (result.status === "saved") {
      await this.refreshContentList(payload.type)

      // 触发后台推送
      const activeRepo = this.getActiveRepository()
      if (activeRepo && result.pendingPushCount > 0) {
        this.scheduleBackgroundPush(activeRepo.uuid)
      }
    }

    return result
  }

  // ===== 内容查询（带缓存）=====
  getContentList<T extends SynapseContentType>(contentType: T): SynapseContentMeta<T>[] {
    return (this.contentCache.get(contentType) as SynapseContentMeta<T>[]) ?? []
  }

  isContentLoading(contentType: SynapseContentType): boolean {
    return this.contentLoading.get(contentType) ?? false
  }

  getContentError(contentType: SynapseContentType): Error | null {
    return this.contentErrors.get(contentType) ?? null
  }

  getContentSnapshot<T extends SynapseContentType>(contentType: T): { items: SynapseContentMeta<T>[]; isLoading: boolean; error: Error | null } {
    const cached = this.contentSnapshots.get(contentType)
    if (cached) {
      return cached as { items: SynapseContentMeta<T>[]; isLoading: boolean; error: Error | null }
    }
    const snapshot = {
      items: this.getContentList(contentType),
      isLoading: this.isContentLoading(contentType),
      error: this.getContentError(contentType),
    }
    this.contentSnapshots.set(contentType, snapshot)
    return snapshot as { items: SynapseContentMeta<T>[]; isLoading: boolean; error: Error | null }
  }

  async refreshContentList<T extends SynapseContentType>(contentType: T): Promise<void> {
    const bridge = getSynapseBridge()?.resourceRepository
    if (!bridge) {
      this.contentErrors.set(contentType, new Error("Content bridge not available"))
      this.notifyContentSubscribers(contentType)
      return
    }

    const activeRepositoryUuid = this.getActiveRepositoryUuid()
    const refreshVersion = (this.contentRefreshVersions.get(contentType) ?? 0) + 1
    this.contentRefreshVersions.set(contentType, refreshVersion)
    this.contentLoading.set(contentType, true)
    this.notifyContentSubscribers(contentType)

    try {
      const items = await bridge.item.list({ contentType })
      if (!this.isCurrentContentRefresh(contentType, refreshVersion, activeRepositoryUuid)) {
        return
      }
      this.contentCache.set(contentType, items as SynapseContentMeta[])
      this.contentErrors.set(contentType, null)
    } catch (error) {
      if (!this.isCurrentContentRefresh(contentType, refreshVersion, activeRepositoryUuid)) {
        return
      }
      this.contentErrors.set(
        contentType,
        error instanceof Error ? error : new Error("Failed to load content"),
      )
    } finally {
      if (this.isCurrentContentRefresh(contentType, refreshVersion, activeRepositoryUuid)) {
        this.contentLoading.set(contentType, false)
        this.notifyContentSubscribers(contentType)
      }
    }
  }

  async refreshAllContent(): Promise<void> {
    await Promise.all([
      this.refreshContentList("rule"),
      this.refreshContentList("skill"),
      this.refreshContentList("prompt"),
    ])
  }

  // ===== 桥接检查 =====
  hasRepositoryBridge(): boolean {
    return Boolean(getSynapseBridge()?.settings.repository)
  }

  hasContentBridge(): boolean {
    return Boolean(getSynapseBridge()?.resourceRepository)
  }

  // ===== 工具方法 =====
  async checkInitializationPreview(uuid: string): Promise<SynapseRepositoryInitializationPreview> {
    const bridge = requireBridgeDomain("settings").repository
    return bridge.checkInitializationPreview(uuid)
  }

  async validateDirectory(targetPath: string): Promise<SynapseRepositoryValidationResult> {
    const bridge = requireBridgeDomain("settings").repository
    return bridge.validateDirectory(targetPath)
  }

  async chooseDirectory(): Promise<string | null> {
    const bridge = getSynapseBridge()?.settings.repository
    if (!bridge) {
      return null
    }
    return bridge.chooseDirectory()
  }

  async createLocalRepository(
    options: SynapseCreateLocalRepositoryPayload,
  ): Promise<SynapseCreateLocalRepositoryResult> {
    const bridge = requireBridgeDomain("settings").repository
    return bridge.createLocalRepository(options)
  }

  async getPendingPushesFromBridge(uuid: string): Promise<SynapsePendingPushState> {
    const bridge = getSynapseBridge()?.settings.repository
    if (!bridge) {
      return { count: 0, items: [] }
    }
    return bridge.getPendingPushes(uuid)
  }

  // ===== 订阅接口 =====
  subscribeToRepositoryChanges(callback: RepositorySubscriber): () => void {
    this.repositorySubscribers.add(callback)

    return () => {
      this.repositorySubscribers.delete(callback)
    }
  }

  subscribeToContentChanges(
    contentType: SynapseContentType,
    callback: ContentSubscriber,
  ): () => void {
    const subscribers = this.contentSubscribers.get(contentType)
    if (!subscribers) {
      this.contentSubscribers.set(contentType, new Set([callback]))
    } else {
      subscribers.add(callback)
    }

    // 如果还没有加载过内容，自动加载
    if (!this.contentCache.has(contentType) && !this.contentLoading.get(contentType)) {
      void this.refreshContentList(contentType)
    }

    return () => {
      this.contentSubscribers.get(contentType)?.delete(callback)
    }
  }

  subscribeToOperationChanges(
    uuid: string,
    callback: OperationSubscriber,
  ): () => void {
    let subscribers = this.operationSubscribers.get(uuid)
    if (!subscribers) {
      subscribers = new Set()
      this.operationSubscribers.set(uuid, subscribers)
    }
    subscribers.add(callback)

    // 立即通知当前状态
    const currentState = this.operations.get(uuid)
    if (currentState) {
      callback(currentState)
    }

    return () => {
      this.operationSubscribers.get(uuid)?.delete(callback)
    }
  }

  // ===== 内部方法 =====
  async refreshRepositoryStates(): Promise<void> {
    const bridge = getSynapseBridge()?.settings.repository
    if (!bridge) {
      return
    }

    try {
      const states = await bridge.getStates()
      this.repositoryStates.clear()
      for (const state of states) {
        this.repositoryStates.set(state.repositoryUuid, state)
      }
      this.notifyRepositorySubscribers()
    } catch {
      // bridge.getStates() 可能因 IPC 断开或数据库查询异常抛出，
      // 保留现有状态不变以避免 UI 闪白，等待下一次 onUpdated 回调重试
    }
  }

  private async refreshPendingPushes(uuid: string): Promise<void> {
    const state = await this.getPendingPushesFromBridge(uuid)
    this.pendingPushes.set(uuid, state)
    this.notifyRepositorySubscribers()
  }

  private async refreshPendingPushesForRepositories(repositoryUuids: string[]): Promise<void> {
    const results = await Promise.allSettled(
      repositoryUuids.map(async (repositoryUuid) => {
        const pendingState = await this.getPendingPushesFromBridge(repositoryUuid)
        this.pendingPushes.set(repositoryUuid, pendingState)
      }),
    )
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn("repository.pending-push-refresh-failed", { error: String(result.reason) })
      }
    }
    this.notifyRepositorySubscribers()
  }

  private async refreshSyncSnapshots(): Promise<void> {
    const bridge = getSynapseBridge()?.settings.repository
    if (!bridge?.getSyncSnapshots) {
      return
    }

    try {
      const snapshots = await bridge.getSyncSnapshots()
      this.syncSnapshots.clear()
      for (const snapshot of snapshots) {
        this.applySyncSnapshot(snapshot)
      }
      this.notifyRepositorySubscribers()
    } catch (error) {
      logger.warn("repository.sync-snapshot-refresh-failed", { error: String(error) })
    }
  }

  private setupBridgeListeners(): void {
    const synapseBridge = getSynapseBridge()
    const bridge = synapseBridge?.settings.repository
    const contentBridge = synapseBridge?.resourceRepository

    this.unsubscribeContentChanged = contentBridge?.item.onChanged?.(
      (event: SynapseContentChangedEvent) => {
        void this.refreshContentList(event.contentType)
      },
    ) ?? null

    if (!bridge) return

    this.unsubscribeProgress = bridge.onProgress((event: SynapseRepositoryProgressEvent) => {
      this.setOperationState(event.repositoryUuid, {
        operation: event.operation,
        isRunning: true,
        statusText: event.statusText,
        percent: event.percent,
        completedAt: null,
      })
    })

    this.unsubscribeUpdated = bridge.onUpdated((event: SynapseRepositoryUpdatedEvent) => {
      if (event.operation === "variables" || !event.repositoryUuid) {
        return
      }

      this.setOperationState(event.repositoryUuid, {
        operation: event.operation,
        isRunning: false,
        statusText: event.error ? event.message ?? null : event.message ?? "完成",
        percent: event.error ? null : 100,
        completedAt: event.completedAt,
        error: event.error,
      })

      void this.refreshRepositoryStates()
    })

    this.unsubscribePendingPushes = bridge.onPendingPushesUpdated(
      (event: SynapsePendingPushUpdatedEvent) => {
        this.pendingPushes.set(event.repositoryUuid, event.pendingPushes)
        this.notifyRepositorySubscribers()
      },
    )

    this.unsubscribeSyncSnapshot = bridge.onSyncSnapshotUpdated?.(
      (event: SynapseRepositorySyncSnapshotUpdatedEvent) => {
        this.applySyncSnapshot(event.snapshot)
        this.notifyRepositorySubscribers()
      },
    ) ?? null
  }

  private applySyncSnapshot(snapshot: SynapseRepositorySyncSnapshot): void {
    this.syncSnapshots.set(snapshot.repositoryUuid, snapshot)
    this.pendingPushes.set(snapshot.repositoryUuid, {
      count: snapshot.pendingCount,
      items: snapshot.pendingItems,
    })
  }

  private setOperationState(uuid: string, state: RepositoryOperationState): void {
    this.operations.set(uuid, state)
    this.notifyRepositorySubscribers()
    this.notifyOperationSubscribers(uuid, state)
  }

  private pruneRepositoryRuntimeState(validRepositoryUuids: Set<string>): void {
    for (const repositoryUuid of this.repositoryStates.keys()) {
      if (!validRepositoryUuids.has(repositoryUuid)) {
        this.repositoryStates.delete(repositoryUuid)
      }
    }

    for (const repositoryUuid of this.operations.keys()) {
      if (!validRepositoryUuids.has(repositoryUuid)) {
        this.operations.delete(repositoryUuid)
      }
    }

    for (const repositoryUuid of this.pendingPushes.keys()) {
      if (!validRepositoryUuids.has(repositoryUuid)) {
        this.pendingPushes.delete(repositoryUuid)
      }
    }

    for (const repositoryUuid of this.syncSnapshots.keys()) {
      if (!validRepositoryUuids.has(repositoryUuid)) {
        this.syncSnapshots.delete(repositoryUuid)
      }
    }
  }

  private notifyRepositorySubscribers(): void {
    for (const subscriber of this.repositorySubscribers) {
      try {
        subscriber()
      } catch (error) {
        logger.warn("repository.subscriber-failed", { error: String(error) })
      }
    }
  }

  private notifyContentSubscribers(contentType: SynapseContentType): void {
    // 引用比较当前值与缓存快照，数据未变则跳过通知
    const current = this.contentSnapshots.get(contentType)
    const items = this.getContentList(contentType)
    const isLoading = this.isContentLoading(contentType)
    const error = this.getContentError(contentType)
    if (current && current.items === items && current.isLoading === isLoading && current.error === error) {
      return
    }

    const snapshot = { items, isLoading, error }
    this.contentSnapshots.set(contentType, snapshot)

    const subscribers = this.contentSubscribers.get(contentType)
    if (!subscribers) return

    for (const subscriber of subscribers) {
      try {
        subscriber()
      } catch (error) {
        logger.warn("repository.content-subscriber-failed", {
          contentType,
          error: String(error),
        })
      }
    }
  }

  private notifyOperationSubscribers(uuid: string, state: RepositoryOperationState): void {
    const subscribers = this.operationSubscribers.get(uuid)
    if (!subscribers) return

    for (const subscriber of subscribers) {
      try {
        subscriber(state)
      } catch (error) {
        logger.warn("repository.operation-subscriber-failed", {
          error: String(error),
          uuid,
        })
      }
    }
  }

  private scheduleBackgroundPush(uuid: string): void {
    // 后台推送由主进程自动处理，这里不需要额外操作
    // 只需要确保 pending pushes 状态会被更新
    void this.refreshPendingPushes(uuid)
  }

  private resetContentForRepositoryChange(): void {
    for (const contentType of ["rule", "skill", "prompt"] as SynapseContentType[]) {
      this.contentRefreshVersions.set(
        contentType,
        (this.contentRefreshVersions.get(contentType) ?? 0) + 1,
      )
      this.contentCache.set(contentType, [])
      this.contentLoading.set(contentType, false)
      this.contentErrors.set(contentType, null)
      this.notifyContentSubscribers(contentType)
    }
  }

  private isCurrentContentRefresh(
    contentType: SynapseContentType,
    refreshVersion: number,
    activeRepositoryUuid: string | null,
  ): boolean {
    return this.contentRefreshVersions.get(contentType) === refreshVersion
      && this.getActiveRepositoryUuid() === activeRepositoryUuid
  }

  private getPreparingStatusText(operation: SynapseRepositoryOperationKind): string {
    switch (operation) {
      case "push":
        return "正在准备推送..."
      case "initialize":
        return "正在准备初始化..."
      case "maintenance":
        return "正在准备整理..."
      default:
        return "正在准备同步..."
    }
  }

  private getCompletedStatusText(operation: SynapseRepositoryOperationKind): string {
    switch (operation) {
      case "push":
        return "同步完成。"
      case "initialize":
        return "初始化完成。"
      case "maintenance":
        return "整理完成。"
      default:
        return "仓库同步完成。"
    }
  }
}

// 单例模式
let repositoryManagerInstance: RepositoryManager | null = null

export function getRepositoryManager(): RepositoryManager {
  if (!repositoryManagerInstance) {
    repositoryManagerInstance = new RepositoryManager()
  }
  return repositoryManagerInstance
}

export function resetRepositoryManager(): void {
  repositoryManagerInstance?.destroy()
  repositoryManagerInstance = null
}

export { RepositoryManager }
