import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseRepositoryConfig,
} from "@/types/config"
import type {
  SynapseContentMeta,
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
  SynapseRepositoryInitializationResult,
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
  SynapseRepositoryUpdatedEvent,
  SynapseRepositoryValidationResult,
} from "@/types/repository"

export type RepositoryOperationState = {
  operation: SynapseRepositoryOperationKind | null
  isRunning: boolean
  statusText: string | null
  percent: number | null
  completedAt: string | null
  error?: string
}

type ContentSubscriber = () => void
type RepositorySubscriber = () => void
type OperationSubscriber = (state: RepositoryOperationState) => void

class RepositoryManager {
  // ===== 配置状态 =====
  private config: SynapseConfig | null = null
  private isConfigReady = false

  // ===== 运行时状态 =====
  private repositoryStates: Map<string, SynapseRepositoryLocalState> = new Map()
  private operations: Map<string, RepositoryOperationState> = new Map()
  private pendingPushes: Map<string, SynapsePendingPushState> = new Map()

  // ===== 内容缓存 =====
  private contentCache: Map<SynapseContentType, SynapseContentMeta[]> = new Map()
  private contentLoading: Map<SynapseContentType, boolean> = new Map()
  private contentErrors: Map<SynapseContentType, Error | null> = new Map()
  private contentSnapshots: Map<SynapseContentType, { items: SynapseContentMeta[]; isLoading: boolean; error: Error | null }> = new Map()

  // ===== 订阅者 =====
  private repositorySubscribers: Set<RepositorySubscriber> = new Set()
  private contentSubscribers: Map<SynapseContentType, Set<ContentSubscriber>> = new Map()
  private operationSubscribers: Map<string, Set<OperationSubscriber>> = new Map()

  // ===== Bridge 监听取消函数 =====
  private unsubscribeProgress: (() => void) | null = null
  private unsubscribeUpdated: (() => void) | null = null
  private unsubscribePendingPushes: (() => void) | null = null

  // ===== 初始化 =====
  async initialize(): Promise<void> {
    await this.refreshConfig()
    this.setupBridgeListeners()
    await this.refreshRepositoryStates()

    // 初始化内容订阅者 Map
    for (const contentType of ["rule", "skill"] as SynapseContentType[]) {
      this.contentSubscribers.set(contentType, new Set())
      this.contentLoading.set(contentType, false)
      this.contentErrors.set(contentType, null)
    }
  }

  destroy(): void {
    this.unsubscribeProgress?.()
    this.unsubscribeUpdated?.()
    this.unsubscribePendingPushes?.()
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

  getRepositories(): SynapseRepositoryConfig[] {
    return this.config?.repositories ?? []
  }

  isReady(): boolean {
    return this.isConfigReady
  }

  async refreshConfig(): Promise<void> {
    const bridge = window.synapse?.config
    if (!bridge) {
      throw new Error("Config bridge not available")
    }

    this.config = await bridge.get()
    this.isConfigReady = true
    this.notifyRepositorySubscribers()
  }

  async updateConfig(patch: SynapseConfigPatch, reset = false): Promise<void> {
    const bridge = window.synapse?.config
    if (!bridge) {
      throw new Error("Config bridge not available")
    }

    this.config = await bridge.update(patch)
    this.notifyRepositorySubscribers()

    if (reset) {
      window.location.reload()
    }
  }

  async switchActiveRepository(uuid: string): Promise<void> {
    // 清空内容快照缓存，避免显示旧仓库数据
    this.contentSnapshots.clear()
    await this.updateConfig({ activeRepoUuid: uuid })
    await this.refreshRepositoryStates()
    // 切换仓库后刷新内容缓存
    await this.refreshAllContent()
  }

  async addRepository(repository: SynapseRepositoryConfig): Promise<void> {
    const repos = [...(this.config?.repositories ?? []), repository]
    await this.updateConfig({ repositories: repos })
  }

  async removeRepository(uuid: string): Promise<void> {
    const repos = (this.config?.repositories ?? []).filter((r) => r.uuid !== uuid)
    const updates: SynapseConfigPatch = { repositories: repos }

    // 如果删除的是当前激活的仓库，清空激活状态
    if (this.config?.activeRepoUuid === uuid) {
      updates.activeRepoUuid = null
    }

    await this.updateConfig(updates)
    this.repositoryStates.delete(uuid)
    this.operations.delete(uuid)
    this.pendingPushes.delete(uuid)
  }

  async updateRepository(
    uuid: string,
    patch: Partial<SynapseRepositoryConfig>,
  ): Promise<void> {
    const repos = (this.config?.repositories ?? []).map((r) =>
      r.uuid === uuid ? { ...r, ...patch } : r,
    )
    await this.updateConfig({ repositories: repos })
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

  async initializeRepository(uuid: string): Promise<SynapseRepositoryInitializationResult> {
    const bridge = window.synapse?.repository
    if (!bridge) {
      throw new Error("Repository bridge not available")
    }

    this.setOperationState(uuid, {
      operation: "initialize",
      isRunning: true,
      statusText: "正在准备初始化...",
      percent: 0,
      completedAt: null,
    })

    try {
      const result = await bridge.initializeStructure(uuid)
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
    const bridge = window.synapse?.repository
    if (!bridge) {
      throw new Error("Repository bridge not available")
    }

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

      await this.refreshPendingPushes(uuid)
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

  async waitForBackgroundPush(uuid: string, timeoutMs = 120000): Promise<void> {
    const bridge = window.synapse?.repository
    if (!bridge) {
      throw new Error("Repository bridge not available")
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        window.clearTimeout(timeoutId)
        unsubscribeUpdated?.()
      }

      const settle = (callback: () => void) => {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        callback()
      }

      const timeoutId = window.setTimeout(() => {
        settle(() => {
          reject(new Error("等待仓库同步超时，请稍后查看右上角同步状态。"))
        })
      }, timeoutMs)

      const unsubscribeUpdated = bridge.onUpdated((updatedEvent) => {
        if (updatedEvent.repositoryUuid !== uuid || updatedEvent.operation !== "push") {
          return
        }

        if (updatedEvent.error) {
          settle(() => {
            reject(new Error(updatedEvent.error ?? updatedEvent.message ?? "同步变更失败。"))
          })
          return
        }

        settle(resolve)
      })

      void bridge.getPendingPushes(uuid)
        .then((pendingState) => {
          const currentOperation = this.operations.get(uuid)
          const isPushRunning =
            currentOperation?.isRunning
            && currentOperation?.operation === "push"

          if (pendingState.count === 0 && !isPushRunning) {
            settle(resolve)
          }
        })
        .catch((error) => {
          settle(() => {
            reject(error instanceof Error ? error : new Error("读取同步状态失败。"))
          })
        })
    })
  }

  // ===== 内容操作（自动刷新）=====
  async createContent<T extends SynapseContentType>(
    contentType: T,
    payload: SynapseCreateContentPayload<T>,
  ): Promise<SynapseContentMutationResult> {
    const bridge = window.synapse?.content
    if (!bridge) {
      throw new Error("Content bridge not available")
    }

    const result = await bridge.create({ contentType, payload } as SynapseCreateContentRequest<T>)

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

  async updateContent<T extends SynapseContentType>(
    contentType: T,
    payload: SynapseUpdateContentPayload<T>,
  ): Promise<SynapseContentMutationResult> {
    const bridge = window.synapse?.content
    if (!bridge) {
      throw new Error("Content bridge not available")
    }

    const result = await bridge.update({ contentType, payload } as SynapseUpdateContentRequest<T>)

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
    const bridge = window.synapse?.content
    if (!bridge) {
      throw new Error("Content bridge not available")
    }

    const result = await bridge.deleteContent(payload)

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
    const bridge = window.synapse?.content
    if (!bridge) {
      this.contentErrors.set(contentType, new Error("Content bridge not available"))
      this.notifyContentSubscribers(contentType)
      return
    }

    this.contentLoading.set(contentType, true)
    this.notifyContentSubscribers(contentType)

    try {
      const items = await bridge.list({ contentType })
      this.contentCache.set(contentType, items as SynapseContentMeta[])
      this.contentErrors.set(contentType, null)
    } catch (error) {
      this.contentErrors.set(
        contentType,
        error instanceof Error ? error : new Error("Failed to load content"),
      )
    } finally {
      this.contentLoading.set(contentType, false)
      this.notifyContentSubscribers(contentType)
    }
  }

  async refreshAllContent(): Promise<void> {
    await Promise.all([
      this.refreshContentList("rule"),
      this.refreshContentList("skill"),
    ])
  }

  // ===== 桥接检查 =====
  hasRepositoryBridge(): boolean {
    return Boolean(window.synapse?.repository)
  }

  hasContentBridge(): boolean {
    return Boolean(window.synapse?.content)
  }

  // ===== 工具方法 =====
  async checkInitializationPreview(uuid: string): Promise<SynapseRepositoryInitializationPreview> {
    const bridge = window.synapse?.repository
    if (!bridge) {
      throw new Error("Repository bridge not available")
    }
    return bridge.checkInitializationPreview(uuid)
  }

  async validateDirectory(targetPath: string): Promise<SynapseRepositoryValidationResult> {
    const bridge = window.synapse?.repository
    if (!bridge) {
      throw new Error("Repository bridge not available")
    }
    return bridge.validateDirectory(targetPath)
  }

  async chooseDirectory(): Promise<string | null> {
    const bridge = window.synapse?.repository
    if (!bridge) {
      return null
    }
    return bridge.chooseDirectory()
  }

  async createLocalRepository(
    options: SynapseCreateLocalRepositoryPayload,
  ): Promise<SynapseCreateLocalRepositoryResult> {
    const bridge = window.synapse?.repository
    if (!bridge) {
      throw new Error("Repository bridge not available")
    }
    return bridge.createLocalRepository(options)
  }

  async getPendingPushesFromBridge(uuid: string): Promise<SynapsePendingPushState> {
    const bridge = window.synapse?.repository
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
    const bridge = window.synapse?.repository
    if (!bridge) {
      return
    }

    const states = await bridge.getStates()
    this.repositoryStates.clear()
    for (const state of states) {
      this.repositoryStates.set(state.repositoryUuid, state)
    }
    this.notifyRepositorySubscribers()
  }

  private async refreshPendingPushes(uuid: string): Promise<void> {
    const state = await this.getPendingPushesFromBridge(uuid)
    this.pendingPushes.set(uuid, state)
    this.notifyRepositorySubscribers()
  }

  private setupBridgeListeners(): void {
    const bridge = window.synapse?.repository
    if (!bridge) {
      return
    }

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
  }

  private setOperationState(uuid: string, state: RepositoryOperationState): void {
    this.operations.set(uuid, state)
    this.notifyOperationSubscribers(uuid, state)
  }

  private notifyRepositorySubscribers(): void {
    for (const subscriber of this.repositorySubscribers) {
      try {
        subscriber()
      } catch {
        // 忽略订阅者错误
      }
    }
  }

  private notifyContentSubscribers(contentType: SynapseContentType): void {
    // 先更新快照缓存，确保订阅者获取到稳定的引用
    const snapshot = {
      items: this.getContentList(contentType),
      isLoading: this.isContentLoading(contentType),
      error: this.getContentError(contentType),
    }
    this.contentSnapshots.set(contentType, snapshot)

    const subscribers = this.contentSubscribers.get(contentType)
    if (!subscribers) return

    for (const subscriber of subscribers) {
      try {
        subscriber()
      } catch {
        // 忽略订阅者错误
      }
    }
  }

  private notifyOperationSubscribers(uuid: string, state: RepositoryOperationState): void {
    const subscribers = this.operationSubscribers.get(uuid)
    if (!subscribers) return

    for (const subscriber of subscribers) {
      try {
        subscriber(state)
      } catch {
        // 忽略订阅者错误
      }
    }
  }

  private scheduleBackgroundPush(uuid: string): void {
    // 后台推送由主进程自动处理，这里不需要额外操作
    // 只需要确保 pending pushes 状态会被更新
    void this.refreshPendingPushes(uuid)
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
