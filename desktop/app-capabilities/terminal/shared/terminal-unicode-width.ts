import { Unicode11Addon } from "@xterm/addon-unicode11"

import {
  TERMINAL_EMOJI_ASTRAL_RANGES,
  TERMINAL_EMOJI_BMP_RANGES,
} from "./terminal-unicode-emoji-ranges"

/**
 * 终端字符宽度表。
 *
 * 背景：xterm.js 默认使用内置的 Unicode 6 宽度表，`@xterm/addon-unicode11` 只补充 East Asian Width，
 * 两者都会把 emoji 基础字符（`⏺`、`◻`、`◼`、`⚠️`、`✔️`、`⚡` 等）算成 1 格。Claude Code、Codex CLI
 * 等按 emoji 规则算 2 格，两边差 1 格会改变长行的换行位置，让这些 CLI 的增量重绘错位、在终端缓冲区里
 * 留下上一帧的字符。这里用官方 addon 的 Unicode 11 表作为基座，再把 emoji 基础字符补成 2 格。
 */

/** 自定义宽度表版本号；渲染端与主进程 headless 仿真器必须使用同一个值。 */
export const TERMINAL_UNICODE_VERSION = "11-emoji"

/** 官方 `@xterm/addon-unicode11` 注册的版本号，用于回退。 */
const UNICODE11_VERSION = "11"

export type TerminalUnicodeWidthStatus =
  /** 已启用“Unicode 11 + emoji 按 2 格”的宽度表。 */
  | "patched"
  /** 只能启用官方 Unicode 11 宽度表（emoji 仍按 1 格）。 */
  | "unicode11"
  /** 都不可用，保持 xterm 默认的 Unicode 6 宽度表。 */
  | "default"

type TerminalUnicodeProvider = {
  readonly version: string
  wcwidth(codepoint: number): 0 | 1 | 2
  charProperties(codepoint: number, preceding: number): number
}

type TerminalUnicodeWidthAddon = {
  activate(terminal: unknown): void
}

/** 渲染端 `@xterm/xterm` 与主进程 `@xterm/headless` 的 `Terminal` 都满足这个结构。 */
export type TerminalUnicodeWidthTarget = {
  readonly unicode: {
    register(provider: TerminalUnicodeProvider): void
    activeVersion: string
  }
}

export type TerminalUnicodeWidthOptions = {
  /** 测试用：替换宽度 addon 工厂；默认使用官方 `@xterm/addon-unicode11`。 */
  readonly createAddon?: () => TerminalUnicodeWidthAddon
}

let bmpEmojiWidths: Uint8Array | undefined

function resolveBmpEmojiWidths(): Uint8Array {
  if (bmpEmojiWidths) return bmpEmojiWidths
  const widths = new Uint8Array(0x10000)
  for (const [start, end] of TERMINAL_EMOJI_BMP_RANGES) widths.fill(1, start, end + 1)
  bmpEmojiWidths = widths
  return widths
}

function isInRanges(codepoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  if (ranges.length === 0) return false
  if (codepoint < ranges[0][0] || codepoint > ranges[ranges.length - 1][1]) return false
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (codepoint > ranges[middle][1]) low = middle + 1
    else if (codepoint < ranges[middle][0]) high = middle - 1
    else return true
  }
  return false
}

/**
 * 该码点是否属于 emoji 基础字符集合（`emoji-data.txt` 的 `Emoji` 属性）。
 * 组合类零宽码点不在表内，因此不会把 keycap 之类的序列算宽。
 */
export function isTerminalEmojiCodePoint(codepoint: number): boolean {
  if (!Number.isInteger(codepoint) || codepoint < 0xa0 || codepoint > 0x10ffff) return false
  if (codepoint < 0x10000) return resolveBmpEmojiWidths()[codepoint] === 1
  return isInRanges(codepoint, TERMINAL_EMOJI_ASTRAL_RANGES)
}

function extractWidth(charProperties: number): number {
  return (charProperties >> 1) & 3
}

function createDefaultAddon(): TerminalUnicodeWidthAddon {
  // addon 的类型绑定在 `@xterm/xterm` 的 Terminal 上，这里只需要它的 `activate` 契约。
  return new Unicode11Addon() as unknown as TerminalUnicodeWidthAddon
}

function captureBaseProvider(createAddon: () => TerminalUnicodeWidthAddon): TerminalUnicodeProvider | undefined {
  let base: TerminalUnicodeProvider | undefined
  // addon 没有导出它的 provider 类，用一次 `activate` 把它注册的 provider 实例捞出来当基座。
  const addon = createAddon()
  addon.activate({
    unicode: {
      register: (provider: TerminalUnicodeProvider) => {
        base = provider
      },
    },
  })
  if (!base) return undefined
  const candidate = base
  if (typeof candidate.wcwidth !== "function" || typeof candidate.charProperties !== "function") {
    return undefined
  }
  return candidate
}

function createPatchedProvider(base: TerminalUnicodeProvider): TerminalUnicodeProvider {
  return {
    version: TERMINAL_UNICODE_VERSION,
    wcwidth: (codepoint) => {
      if (!isTerminalEmojiCodePoint(codepoint)) return base.wcwidth(codepoint)
      // 组合类零宽码点保持 0 宽，避免把 keycap / 修饰符序列算宽。
      return base.wcwidth(codepoint) === 0 ? 0 : 2
    },
    charProperties: (codepoint, preceding) => {
      if (!isTerminalEmojiCodePoint(codepoint)) return base.charProperties(codepoint, preceding)
      const baseProperties = base.charProperties(codepoint, preceding)
      return extractWidth(baseProperties) === 0 ? baseProperties : 2 << 1
    },
  }
}

/**
 * 给终端装上“Unicode 11 + emoji 按 2 格”的宽度表。
 *
 * 必须在写入任何数据（包括恢复序列化快照）之前调用，且渲染端与主进程 headless 仿真器都要调用，
 * 否则两边换行不一致，序列化恢复会对不上。该函数不会抛错，失败时逐级回退并返回状态供调用方记录日志。
 */
export function installTerminalUnicodeWidth(
  terminal: TerminalUnicodeWidthTarget,
  options?: TerminalUnicodeWidthOptions,
): TerminalUnicodeWidthStatus {
  const createAddon = options?.createAddon ?? createDefaultAddon
  try {
    const base = captureBaseProvider(createAddon)
    if (base) {
      const patched = createPatchedProvider(base)
      terminal.unicode.register(patched)
      terminal.unicode.activeVersion = patched.version
      if (terminal.unicode.activeVersion === patched.version) return "patched"
    }
  } catch {
    // 继续尝试只启用官方宽度表。
  }
  try {
    createAddon().activate(terminal)
    terminal.unicode.activeVersion = UNICODE11_VERSION
    if (terminal.unicode.activeVersion === UNICODE11_VERSION) return "unicode11"
  } catch {
    // 保持 xterm 默认宽度表。
  }
  return "default"
}
