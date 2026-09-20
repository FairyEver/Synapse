import { createRendererLogger } from "../../../src/app-shell/logging"

const logger = createRendererLogger("terminal.atlas-repair")

/**
 * 图集重构之后等多长的安静期才动手重建。
 *
 * 合并只发生在持续输出的时候，那时候重建会把正在刷屏的那一帧整个重新光栅化。
 * 等一小段安静期再动，用户此时已经在读屏，重建只花一帧，看不出来。
 */
const REPAIR_QUIET_MS = 1_500

/**
 * 两次重建之间的最小间隔。
 *
 * 一屏不同配色的汉字本来就贴着图集上限，长时间会话里会反复合并。没有下限的话
 * 每合并一次就重建一次，重建本身会变成新的卡顿来源；有下限时最坏也只是某次合并
 * 之后晚十几秒恢复。第一次重建不受这条限制。
 */
const REPAIR_MIN_INTERVAL_MS = 15_000

/**
 * 重建共用同一张字形图集的所有终端。
 *
 * 终端里的中文出现重影、残缺或英文碎片（滚动、刷新都冲不掉，拖着改窗口大小才恢复），
 * 是 WebGL 渲染器的字形图集坏掉，不是缓冲区里的字错了——复制全文粘出来是干净的。
 *
 * 触发点是图集的**页合并**：一页装不下时 addon 会把几页并成一页，并重算已缓存字形
 * 在新页里的位置。但渲染端有两处不会跟着走：逐格顶点只在字形或颜色变化时才重写，
 * GPU 上的页纹理也只在版本号变化时才重新上传。于是那些格子继续按旧位置去图集里取图，
 * 画出来就是别的字形。addon 没有暴露合并事件以外的自愈入口，重建整张图集（清页 +
 * 清缓存 + 重新光栅化）是唯一能把它拉回来的动作。
 *
 * 图集在多个分屏之间是共享的：只重建当前分屏会让其他分屏取到被清空的字形。所以目标
 * 按注册表整组重建，而不是按分屏各修各的。
 */
export type TerminalAtlasRepairScheduler = {
  /** 登记一个待重建的终端；返回的 dispose 解除登记，最后一个解除时顺带取消待办。 */
  register(repair: () => void): { dispose(): void }
  /** 图集发生过一次重构（一次页合并）。多次调用只会在安静期结束后重建一次。 */
  notifyRestructured(): void
  dispose(): void
}

export function createTerminalAtlasRepairScheduler(
  options: {
    quietMs?: number
    minIntervalMs?: number
    now?: () => number
    onRepair?: (targetCount: number) => void
  } = {},
): TerminalAtlasRepairScheduler {
  const quietMs = options.quietMs ?? REPAIR_QUIET_MS
  const minIntervalMs = options.minIntervalMs ?? REPAIR_MIN_INTERVAL_MS
  const now = options.now ?? (() => Date.now())
  const targets = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  // 没有上一次就代表还没重建过，第一次重建不该被最小间隔挡住。
  let lastRepairAt: number | undefined

  const cancel = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = (delayMs: number) => {
    cancel()
    timer = setTimeout(run, Math.max(0, delayMs))
  }

  const run = () => {
    timer = undefined
    if (targets.size === 0) return
    const sinceLastRepair = lastRepairAt === undefined
      ? Number.POSITIVE_INFINITY
      : now() - lastRepairAt
    if (sinceLastRepair < minIntervalMs) {
      schedule(minIntervalMs - sinceLastRepair)
      return
    }
    lastRepairAt = now()
    const pending = [...targets]
    for (const repair of pending) repair()
    options.onRepair?.(pending.length)
  }

  return {
    register(repair) {
      targets.add(repair)
      return {
        dispose() {
          targets.delete(repair)
          if (targets.size === 0) cancel()
        },
      }
    },
    notifyRestructured() {
      if (targets.size === 0) return
      schedule(quietMs)
    },
    dispose() {
      cancel()
      targets.clear()
    },
  }
}

const scheduler = createTerminalAtlasRepairScheduler({
  onRepair: (panes) => {
    logger.info("Rebuilt terminal glyph atlas after a page merge.", { panes })
  },
})

export function registerTerminalAtlasRepair(repair: () => void): { dispose(): void } {
  return scheduler.register(repair)
}

export function notifyTerminalAtlasRestructured(): void {
  scheduler.notifyRestructured()
}
