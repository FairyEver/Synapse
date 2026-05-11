// ANSI color primitives
const A = {
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
  cyan:         '\x1b[36m',
  green:        '\x1b[32m',
  yellow:       '\x1b[33m',
  red:          '\x1b[31m',
  blue:         '\x1b[34m',
  magenta:      '\x1b[35m',
  brightCyan:   '\x1b[96m',
  brightGreen:  '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightWhite:  '\x1b[97m',
}

export const c = {
  dim:       (s: string) => `${A.dim}${s}${A.reset}`,
  bold:      (s: string) => `${A.bold}${s}${A.reset}`,
  cyan:      (s: string) => `${A.brightCyan}${s}${A.reset}`,
  green:     (s: string) => `${A.brightGreen}${s}${A.reset}`,
  yellow:    (s: string) => `${A.brightYellow}${s}${A.reset}`,
  red:       (s: string) => `${A.red}${s}${A.reset}`,
  magenta:   (s: string) => `${A.magenta}${s}${A.reset}`,
  boldCyan:  (s: string) => `${A.bold}${A.brightCyan}${s}${A.reset}`,
  boldGreen: (s: string) => `${A.bold}${A.brightGreen}${s}${A.reset}`,
  boldRed:   (s: string) => `${A.bold}${A.red}${s}${A.reset}`,
  boldYellow:(s: string) => `${A.bold}${A.brightYellow}${s}${A.reset}`,
}

/** Strip ANSI escape codes for clean file output */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

const BOX_WIDTH = 64

/** Render a box with top/bottom border.  Lines may contain ANSI codes. */
export function box(lines: string[]): string {
  const top    = `${A.dim}╭${'─'.repeat(BOX_WIDTH)}╮${A.reset}`
  const bottom = `${A.dim}╰${'─'.repeat(BOX_WIDTH)}╯${A.reset}`
  const body = lines.map(l => {
    const plainLen = stripAnsi(l).length
    const pad = Math.max(0, BOX_WIDTH - 2 - plainLen)
    return `${A.dim}│${A.reset} ${l}${' '.repeat(pad)} ${A.dim}│${A.reset}`
  })
  return [top, ...body, bottom].join('\n')
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Spinner {
  private frame = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private active = false
  private label = ''

  start(label: string): void {
    this.label = label
    if (this.active) return
    this.active = true
    process.stdout.write('\x1b[?25l')
    this.timer = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]
      process.stdout.write(`\r${c.cyan(f)} ${c.dim(this.label)}   `)
      this.frame++
    }, 80)
  }

  update(label: string): void {
    this.label = label
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    process.stdout.write('\r\x1b[K')
    process.stdout.write('\x1b[?25h')
  }
}

/** Format a tool_use block in Claude Code style */
export function formatToolCall(name: string, input: Record<string, unknown>): string {
  const header = `${c.boldCyan('◆')} ${c.bold(name)}`
  const entries = Object.entries(input)
  if (entries.length === 0) return `\n${header}\n`

  const rows = entries.map(([k, v], i) => {
    const isLast = i === entries.length - 1
    const prefix = isLast ? '└' : '├'
    const raw = typeof v === 'string' ? v : JSON.stringify(v)
    const short = raw.length > 90 ? raw.slice(0, 87) + '…' : raw
    const val = /[/\\]/.test(short) ? c.yellow(short) : c.dim(short)
    return `  ${c.dim(prefix)} ${c.dim(k + ':')} ${val}`
  })

  return `\n${header}\n${rows.join('\n')}\n`
}

/** Locale timestamp, dim */
export function ts(date: Date): string {
  return c.dim(
    date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
  )
}

/** Duration string */
export function dur(ms: number): string {
  return ms < 1000 ? c.dim(`${ms}ms`) : c.dim(`${(ms / 1000).toFixed(1)}s`)
}
