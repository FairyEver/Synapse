import { MEETING_LIVE_WINDOW_MS, MEETING_PEAK_MS } from "@synapse/shared"

/**
 * 波形绘制。
 *
 * 纯原生画布，不新增任何依赖。整块逻辑单独放一个文件，将来若要换成波形库，只需要
 * 动这一个文件。
 *
 * **不要用 AudioWorklet。** 生产环境渲染进程是 `file://` 页面，`addModule` 会因跨源
 * 限制失败，而开发环境用 `http://localhost` 根本看不出来。这里只用 `AnalyserNode`
 * 取数据，不涉及模块加载，没有这个限制。
 *
 * 两条波形是**故意不一样**的：
 * - 录音中的那条**密度固定**：一个采样永远占同样宽的槽位，贴右边缘、从右往左长，
 *   装满之后旧的从左边滚出去。按画布宽度拉伸铺满的话，录得越久就是把整段越压越扁。
 * - 回放的那条反过来，**整段铺满宽度**，作用是一眼看完整段录音。
 * 这是有意的差异，不要顺手统一。
 */

export const WAVE_BAR_WIDTH = 1.5
export const WAVE_BAR_GAP = 1.1
/** 柱子的最大半高相对画布中线的比例，留出上下边距。 */
export const WAVE_AMPLITUDE_SCALE = 0.9

export type WaveBar = {
  /** 柱子中心的横坐标。 */
  readonly x: number
  /** 归一化振幅 0-1。 */
  readonly amplitude: number
}

export type LiveWaveLayout = {
  /** 槽位总数：同时受时间窗口和画布宽度限制。 */
  readonly slots: number
  /** 当前可见的柱子，已按右对齐排好。 */
  readonly bars: readonly WaveBar[]
  readonly columnWidth: number
}

function columnWidth(barWidth: number, gap: number): number {
  return barWidth + gap
}

/**
 * 录音中的波形布局。
 *
 * 槽位数取「时间窗口能装多少个采样」和「画布宽度能画多少根柱子」里**小的那个**，
 * 这样最新的柱子永远不会被挤出右边缘。装满之前左边的空位空着（右对齐）。
 */
export function computeLiveWaveLayout(
  peaks: ArrayLike<number>,
  canvasWidth: number,
  options: {
    readonly barWidth?: number
    readonly gap?: number
    readonly windowMs?: number
    readonly peakMs?: number
  } = {},
): LiveWaveLayout {
  const barWidth = options.barWidth ?? WAVE_BAR_WIDTH
  const gap = options.gap ?? WAVE_BAR_GAP
  const windowMs = options.windowMs ?? MEETING_LIVE_WINDOW_MS
  const peakMs = options.peakMs ?? MEETING_PEAK_MS
  const column = columnWidth(barWidth, gap)

  const windowSlots = Math.max(1, Math.round(windowMs / peakMs))
  const widthSlots = Math.max(1, Math.floor(canvasWidth / column))
  const slots = Math.max(1, Math.min(windowSlots, widthSlots))

  const total = peaks.length
  if (total === 0) return { slots, bars: [], columnWidth: column }

  const visibleCount = Math.min(total, slots)
  const firstIndex = total - visibleCount
  // 贴右边缘：最新的在右边，早的往左排；没装满时左边的槽位空着。
  const startColumn = slots - visibleCount
  const bars: WaveBar[] = []
  for (let offset = 0; offset < visibleCount; offset += 1) {
    bars.push({
      x: (startColumn + offset) * column + column / 2,
      amplitude: peaks[firstIndex + offset] ?? 0,
    })
  }
  return { slots, bars, columnWidth: column }
}

/**
 * 回放波形的重采样：把整段振幅按画布宽度重新分桶，每个桶取最大值。
 *
 * 取最大值而不是平均值——平均会把一个尖峰稀释掉，画出来比实际安静，而这条波形的
 * 用处正是让人一眼看出「哪一段在说话」。
 */
export function resamplePlaybackPeaks(peaks: ArrayLike<number>, columns: number): number[] {
  const total = peaks.length
  if (total === 0 || columns <= 0) return []
  if (total <= columns) return Array.from({ length: total }, (_, index) => peaks[index] ?? 0)
  const result: number[] = []
  const step = total / columns
  for (let column = 0; column < columns; column += 1) {
    const start = Math.floor(column * step)
    const end = Math.min(total, Math.max(start + 1, Math.ceil((column + 1) * step)))
    let max = 0
    for (let index = start; index < end; index += 1) {
      const value = peaks[index] ?? 0
      if (value > max) max = value
    }
    result.push(max)
  }
  return result
}

/** 从当前主题取前景色。深浅色切换时重画一次就能跟着变，不引入自定义颜色。 */
export function resolveWaveColor(element: HTMLElement): string {
  const value = getComputedStyle(element).getPropertyValue("--foreground").trim()
  return value || "currentColor"
}

/** 尚未播到的那一段用次要文字色，让「播到哪儿了」一眼可见。 */
export function resolveWaveMutedColor(element: HTMLElement): string {
  const value = getComputedStyle(element).getPropertyValue("--muted-foreground").trim()
  return value || "currentColor"
}

type CanvasLike = HTMLCanvasElement

function prepareCanvas(canvas: CanvasLike): { readonly context: CanvasRenderingContext2D; readonly width: number; readonly height: number } | null {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width <= 0 || height <= 0) return null
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const context = canvas.getContext("2d")
  if (!context) return null
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  return { context, width, height }
}

function strokeBar(
  context: CanvasRenderingContext2D,
  x: number,
  amplitude: number,
  mid: number,
  barWidth: number,
): void {
  const half = Math.max(1, amplitude * mid * WAVE_AMPLITUDE_SCALE)
  context.beginPath()
  context.moveTo(x, mid - half)
  context.lineTo(x, mid + half)
  context.stroke()
}

/** 录音中的那条：密度固定、贴右边缘、只回看最近 5 秒。 */
export function drawLiveWaveform(canvas: CanvasLike, peaks: ArrayLike<number>): void {
  const prepared = prepareCanvas(canvas)
  if (!prepared) return
  const { context, width, height } = prepared
  const layout = computeLiveWaveLayout(peaks, width, {
    barWidth: WAVE_BAR_WIDTH,
    gap: WAVE_BAR_GAP,
  })
  if (layout.bars.length === 0) return
  context.strokeStyle = resolveWaveColor(canvas)
  context.lineCap = "round"
  context.lineWidth = WAVE_BAR_WIDTH
  for (const bar of layout.bars) strokeBar(context, bar.x, bar.amplitude, height / 2, WAVE_BAR_WIDTH)
}

/**
 * 回放的那条：整段铺满宽度。
 *
 * 给了 `progress` 时把已播和没播分成两个颜色，播放头那根竖线因此有了意义；不给就是
 * 一整条前景色。
 */
export function drawPlaybackWaveform(
  canvas: CanvasLike,
  peaks: ArrayLike<number>,
  options: {
    readonly barWidth?: number
    readonly gap?: number
    readonly dimmed?: boolean
    readonly progress?: number
  } = {},
): void {
  const prepared = prepareCanvas(canvas)
  if (!prepared) return
  const { context, width, height } = prepared
  const barWidth = options.barWidth ?? WAVE_BAR_WIDTH
  const gap = options.gap ?? WAVE_BAR_GAP
  const column = columnWidth(barWidth, gap)
  const columns = Math.max(1, Math.floor(width / column))
  const resampled = resamplePlaybackPeaks(peaks, columns)
  if (resampled.length === 0) return
  const played = resolveWaveColor(canvas)
  const remaining = resolveWaveMutedColor(canvas)
  const split = Math.max(0, Math.min(1, options.progress ?? 1)) * resampled.length
  context.globalAlpha = options.dimmed ? 0.4 : 1
  context.lineCap = "round"
  context.lineWidth = barWidth
  const mid = height / 2
  for (let index = 0; index < resampled.length; index += 1) {
    context.strokeStyle = index < split ? played : remaining
    strokeBar(context, index * column + column / 2, resampled[index], mid, barWidth)
  }
  context.globalAlpha = 1
}

/** 命中测试：点在波形哪个位置，就跳到那一段。 */
export function playbackPositionFromClick(
  offsetX: number,
  canvasWidth: number,
  durationMs: number,
): number {
  if (canvasWidth <= 0) return 0
  const ratio = Math.max(0, Math.min(1, offsetX / canvasWidth))
  return Math.round(ratio * Math.max(0, durationMs))
}
