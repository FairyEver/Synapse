import type { WebContents, IpcMain } from "electron"
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  FREEZE_THRESHOLD_MISSES,
  DIAGNOSTICS_PING_CHANNEL,
  DIAGNOSTICS_PONG_CHANNEL,
} from "./constants"

interface RendererHealthLogger {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

export interface RendererHealthServiceDeps {
  readonly logger: RendererHealthLogger
  readonly ipcMain?: IpcMain
  readonly sendRendererMessage?: (target: WebContents, channel: string, payload?: unknown) => void
  readonly onUnavailable?: (
    target: WebContents,
    reason: "crashed" | "unresponsive",
    details?: { readonly reason?: string; readonly exitCode?: number },
  ) => void | Promise<void>
  readonly onUnresponsive?: (target: WebContents) => void | Promise<void>
  readonly onResponsive?: (target: WebContents) => void | Promise<void>
}

export class RendererHealthService {
  private readonly logger: RendererHealthLogger
  private readonly sendRendererMessage: (target: WebContents, channel: string, payload?: unknown) => void
  private webContents: WebContents | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private consecutiveMisses = 0
  private lastPongAt: string | null = null
  private frozen = false
  private pongHandler: (() => void) | null = null
  private crashHandler: ((event: unknown, details: { reason: string; exitCode: number }) => void) | null = null
  private unresponsiveHandler: (() => void) | null = null
  private responsiveHandler: (() => void) | null = null
  private unresponsiveTimer: ReturnType<typeof setTimeout> | null = null
  private unavailableTimer: ReturnType<typeof setTimeout> | null = null
  private unavailableHandling = false
  private unresponsive = false
  private readonly onUnavailable: RendererHealthServiceDeps["onUnavailable"]
  private readonly onUnresponsive: RendererHealthServiceDeps["onUnresponsive"]
  private readonly onResponsive: RendererHealthServiceDeps["onResponsive"]

  constructor(deps: RendererHealthServiceDeps) {
    this.logger = deps.logger
    this.sendRendererMessage = deps.sendRendererMessage ?? defaultRendererMessageSender
    this.onUnavailable = deps.onUnavailable
    this.onUnresponsive = deps.onUnresponsive
    this.onResponsive = deps.onResponsive
  }

  attach(webContents: WebContents): void {
    this.detach()
    this.webContents = webContents
    this.consecutiveMisses = 0
    this.frozen = false
    this.unavailableHandling = false
    this.unresponsive = false
    this.lastPongAt = new Date().toISOString()

    this.pongHandler = () => {
      this.handlePong()
    }
    webContents.ipc.on(DIAGNOSTICS_PONG_CHANNEL, this.pongHandler)

    this.crashHandler = (_event, details) => {
      this.logger.error("渲染进程崩溃", {
        reason: details.reason,
        exitCode: details.exitCode,
      })
      this.handleUnavailable("crashed", details)
    }
    webContents.on("render-process-gone" as never, this.crashHandler as never)

    this.unresponsiveHandler = () => {
      if (this.unresponsiveTimer || this.unavailableHandling) return
      this.unresponsive = true
      this.logger.warn("渲染进程无响应，暂停事件投递", { waitMs: 5_000 })
      void Promise.resolve(this.onUnresponsive?.(webContents)).catch((error) => {
        this.logger.error("暂停渲染事件投递失败", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      this.unresponsiveTimer = setTimeout(() => {
        this.unresponsiveTimer = null
        this.handleUnavailable("unresponsive")
      }, 5_000)
    }
    this.responsiveHandler = () => {
      const shouldResume = this.unresponsive && !this.unavailableHandling
      this.unresponsive = false
      if (this.unresponsiveTimer) {
        clearTimeout(this.unresponsiveTimer)
        this.unresponsiveTimer = null
      }
      this.handlePong()
      if (shouldResume) {
        void Promise.resolve(this.onResponsive?.(webContents)).catch((error) => {
          this.logger.error("恢复渲染事件投递失败", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }
    webContents.on("unresponsive" as never, this.unresponsiveHandler as never)
    webContents.on("responsive" as never, this.responsiveHandler as never)

    this.intervalTimer = setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL_MS)
  }

  detach(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
    if (this.unresponsiveTimer) {
      clearTimeout(this.unresponsiveTimer)
      this.unresponsiveTimer = null
    }
    if (this.unavailableTimer) {
      clearTimeout(this.unavailableTimer)
      this.unavailableTimer = null
    }
    if (this.webContents && this.pongHandler) {
      this.webContents.ipc.removeListener(DIAGNOSTICS_PONG_CHANNEL, this.pongHandler)
      this.pongHandler = null
    }
    if (this.webContents && this.crashHandler) {
      this.webContents.removeListener("render-process-gone" as never, this.crashHandler as never)
      this.crashHandler = null
    }
    if (this.webContents && this.unresponsiveHandler) {
      this.webContents.removeListener("unresponsive" as never, this.unresponsiveHandler as never)
      this.unresponsiveHandler = null
    }
    if (this.webContents && this.responsiveHandler) {
      this.webContents.removeListener("responsive" as never, this.responsiveHandler as never)
      this.responsiveHandler = null
    }
    this.webContents = null
    this.unresponsive = false
    this.unavailableHandling = false
  }

  private handleUnavailable(
    reason: "crashed" | "unresponsive",
    details?: { readonly reason?: string; readonly exitCode?: number },
  ): void {
    const target = this.webContents
    if (!target || this.unavailableHandling) return
    this.unavailableHandling = true
    this.unavailableTimer = setTimeout(() => {
      this.unavailableTimer = null
      if (this.webContents !== target) {
        this.unavailableHandling = false
        return
      }
      Promise.resolve(this.onUnavailable?.(target, reason, details)).catch((error) => {
        this.logger.error("渲染进程恢复处理失败", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
      }).finally(() => {
        this.unavailableHandling = false
        this.consecutiveMisses = 0
        this.frozen = false
      })
    }, 0)
  }

  private sendPing(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return

    try {
      this.sendRendererMessage(this.webContents, DIAGNOSTICS_PING_CHANNEL)
    } catch (err) {
      this.logger.warn("心跳发送失败，停止健康检查", { error: String(err) })
      this.detach()
      return
    }

    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private handlePong(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }

    const wasFrozen = this.frozen
    this.consecutiveMisses = 0
    this.frozen = false
    this.lastPongAt = new Date().toISOString()

    if (wasFrozen) {
      this.logger.info("渲染进程恢复响应", { lastPongAt: this.lastPongAt })
    }
  }

  private handleTimeout(): void {
    this.timeoutTimer = null
    this.consecutiveMisses++

    if (this.consecutiveMisses >= FREEZE_THRESHOLD_MISSES) {
      if (!this.frozen) {
        this.frozen = true
        this.logger.error("渲染进程疑似冻结", {
          consecutiveMisses: this.consecutiveMisses,
          lastPongAt: this.lastPongAt,
        })
        this.handleUnavailable("unresponsive")
      }
    } else {
      this.logger.warn("渲染进程无响应", {
        lastPongAt: this.lastPongAt,
        elapsed: `${this.consecutiveMisses * HEARTBEAT_INTERVAL_MS / 1000}s`,
      })
    }
  }
}

function defaultRendererMessageSender(target: WebContents, channel: string, payload?: unknown): void {
  if (payload === undefined) {
    target.send(channel)
    return
  }
  target.send(channel, payload)
}
