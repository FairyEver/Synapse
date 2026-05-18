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
}

export class RendererHealthService {
  private readonly logger: RendererHealthLogger
  private webContents: WebContents | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private consecutiveMisses = 0
  private lastPongAt: string | null = null
  private frozen = false
  private pongHandler: (() => void) | null = null
  private crashHandler: ((event: unknown, details: { reason: string; exitCode: number }) => void) | null = null

  constructor(deps: RendererHealthServiceDeps) {
    this.logger = deps.logger
  }

  attach(webContents: WebContents): void {
    this.detach()
    this.webContents = webContents
    this.consecutiveMisses = 0
    this.frozen = false
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
    }
    webContents.on("render-process-gone" as never, this.crashHandler as never)

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
    if (this.webContents && this.pongHandler) {
      this.webContents.ipc.removeListener(DIAGNOSTICS_PONG_CHANNEL, this.pongHandler)
      this.pongHandler = null
    }
    if (this.webContents && this.crashHandler) {
      this.webContents.removeListener("render-process-gone" as never, this.crashHandler as never)
      this.crashHandler = null
    }
    this.webContents = null
  }

  private sendPing(): void {
    if (!this.webContents || this.webContents.isDestroyed()) return

    try {
      this.webContents.send(DIAGNOSTICS_PING_CHANNEL)
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
      }
    } else {
      this.logger.warn("渲染进程无响应", {
        lastPongAt: this.lastPongAt,
        elapsed: `${this.consecutiveMisses * HEARTBEAT_INTERVAL_MS / 1000}s`,
      })
    }
  }
}
