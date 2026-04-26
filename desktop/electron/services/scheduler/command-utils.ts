export interface ParsedScheduleCommand {
  readonly cronExpr: string
  readonly body: string
}

export function parseSlashCommand(content: string, command: string): string[] | null {
  const trimmed = content.trim()
  const prefix = `/${command}`
  if (trimmed !== prefix && !trimmed.startsWith(`${prefix} `)) return null
  return splitArgs(trimmed.slice(prefix.length).trim())
}

export function parseScheduleArgs(args: readonly string[]): ParsedScheduleCommand | null {
  if (args.length < 2) return null
  if (args[0]?.split(/\s+/).filter(Boolean).length === 5) {
    return {
      cronExpr: args[0],
      body: args.slice(1).join(" ").trim(),
    }
  }
  if (args.length < 6) return null
  return {
    cronExpr: args.slice(0, 5).join(" "),
    body: args.slice(5).join(" ").trim(),
  }
}

function splitArgs(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: "\"" | "'" | null = null
  let escaping = false
  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === "\\") {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === "\"" || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += char
  }
  if (current) args.push(current)
  return args
}
