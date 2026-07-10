import { parseEnv } from "node:util"

export type DotenvEntry = {
  readonly name: string
  readonly value: string
  readonly line: number
  readonly valueStart: number
  readonly valueEnd: number
}

export type DotenvDocument = {
  readonly content: string
  readonly newline: "\n" | "\r\n"
  readonly entries: readonly DotenvEntry[]
}

const DOTENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function normalizedName(name: string): string {
  return name.toLowerCase()
}

function serializeDotenvValue(name: string, value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n")
  for (const delimiter of ['"', "'", "`"] as const) {
    if (normalized.includes(delimiter)) {
      continue
    }
    const candidate = `${delimiter}${normalized}${delimiter}`
    if (parseEnv(`${name}=${candidate}\n`)[name] === normalized) {
      return candidate
    }
  }
  throw new Error(`配置值无法无损写入：${name}`)
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t"
}

function isNewline(content: string, index: number): boolean {
  return content[index] === "\n" || content[index] === "\r"
}

function consumeNewline(content: string, index: number): number {
  if (content[index] === "\r" && content[index + 1] === "\n") {
    return index + 2
  }
  return index + 1
}

function decodeEntryValue(name: string, rawValue: string): string {
  const decoded = parseEnv(`${name}=${rawValue}\n`)[name]
  if (decoded === undefined) {
    throw new Error(`无法解析配置键：${name}`)
  }
  return decoded.replace(/\r\n?/g, "\n")
}

function normalizedValues(values: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const normalized = new Map<string, string>()
  for (const [name, value] of Object.entries(values)) {
    if (!DOTENV_NAME.test(name)) {
      throw new Error(`配置键无效：${name}`)
    }
    if (value.includes("\0")) {
      throw new Error(`配置值不能包含 NUL 字节：${name}`)
    }
    const key = normalizedName(name)
    if (normalized.has(key)) {
      throw new Error(`配置键重复：${name}`)
    }
    normalized.set(key, value)
  }
  return normalized
}

export function parseDotenvDocument(content: string): DotenvDocument {
  if (content.includes("\0")) {
    throw new Error("配置文件不能包含 NUL 字节")
  }

  const entries: DotenvEntry[] = []
  const names = new Set<string>()
  let index = 0
  let line = 1

  while (index < content.length) {
    while (isHorizontalWhitespace(content[index])) {
      index += 1
    }

    if (isNewline(content, index)) {
      index = consumeNewline(content, index)
      line += 1
      continue
    }

    if (content[index] === "#") {
      while (index < content.length && !isNewline(content, index)) {
        index += 1
      }
      continue
    }

    const declarationLine = line
    if (
      content.startsWith("export", index)
      && isHorizontalWhitespace(content[index + "export".length])
    ) {
      index += "export".length
      while (isHorizontalWhitespace(content[index])) {
        index += 1
      }
    }

    const nameStart = index
    while (
      index < content.length
      && !isHorizontalWhitespace(content[index])
      && content[index] !== "="
      && content[index] !== "#"
      && !isNewline(content, index)
    ) {
      index += 1
    }
    const name = content.slice(nameStart, index)
    if (!DOTENV_NAME.test(name)) {
      throw new Error(`配置键无效：${name || `第 ${declarationLine} 行`}`)
    }

    while (isHorizontalWhitespace(content[index])) {
      index += 1
    }
    if (content[index] !== "=") {
      throw new Error(`配置格式无效：第 ${declarationLine} 行缺少等号`)
    }
    index += 1
    while (isHorizontalWhitespace(content[index])) {
      index += 1
    }

    const valueStart = index
    let valueEnd = index
    const quote = content[index]
    if (quote === "'" || quote === '"' || quote === "`") {
      index += 1
      let closed = false
      while (index < content.length) {
        if (content[index] === quote) {
          index += 1
          closed = true
          break
        }
        if (isNewline(content, index)) {
          index = consumeNewline(content, index)
          line += 1
          continue
        }
        index += 1
      }
      if (!closed) {
        throw new Error(`配置值引号未闭合：${name}`)
      }
      valueEnd = index
      while (isHorizontalWhitespace(content[index])) {
        index += 1
      }
      if (content[index] !== "#" && index < content.length && !isNewline(content, index)) {
        throw new Error(`配置格式无效：${name} 的引号后存在多余内容`)
      }
    } else {
      while (index < content.length && content[index] !== "#" && !isNewline(content, index)) {
        index += 1
      }
      valueEnd = index
      while (valueEnd > valueStart && isHorizontalWhitespace(content[valueEnd - 1])) {
        valueEnd -= 1
      }
    }

    const normalized = normalizedName(name)
    if (names.has(normalized)) {
      throw new Error(`配置键重复：${name}`)
    }
    names.add(normalized)
    entries.push({
      name,
      value: decodeEntryValue(name, content.slice(valueStart, valueEnd)),
      line: declarationLine,
      valueStart,
      valueEnd,
    })

    while (index < content.length && !isNewline(content, index)) {
      index += 1
    }
  }

  return {
    content,
    newline: content.includes("\r\n") ? "\r\n" : "\n",
    entries,
  }
}

export function patchDotenvValues(
  content: string,
  values: Readonly<Record<string, string>>,
): string {
  const document = parseDotenvDocument(content)
  const replacements = normalizedValues(values)
  const selectedEntries = document.entries
    .filter((entry) => replacements.has(normalizedName(entry.name)))
    .sort((left, right) => right.valueStart - left.valueStart)

  let result = content
  for (const entry of selectedEntries) {
    const value = replacements.get(normalizedName(entry.name))
    if (value === undefined) {
      continue
    }
    result = `${result.slice(0, entry.valueStart)}${serializeDotenvValue(entry.name, value)}${result.slice(entry.valueEnd)}`
  }
  return result
}

export function createDotenvFromExample(
  example: string,
  values: Readonly<Record<string, string>>,
): string {
  return patchDotenvValues(example, values)
}

function withNewlineStyle(value: string, newline: "\n" | "\r\n"): string {
  return value.replace(/\r\n?|\n/g, newline)
}

export function mergeDotenvExample(
  existing: string,
  example: string,
  values: Readonly<Record<string, string>>,
): string {
  const patchedExisting = patchDotenvValues(existing, values)
  const existingDocument = parseDotenvDocument(patchedExisting)
  const existingNames = new Set(
    existingDocument.entries.map((entry) => normalizedName(entry.name)),
  )
  const patchedExample = patchDotenvValues(example, values)
  const exampleDocument = parseDotenvDocument(patchedExample)
  const declarations = exampleDocument.entries
    .filter((entry) => !existingNames.has(normalizedName(entry.name)))
    .map((entry) => {
      const rawValue = patchedExample.slice(entry.valueStart, entry.valueEnd)
      return `${entry.name}=${withNewlineStyle(rawValue, existingDocument.newline)}`
    })

  if (declarations.length === 0) {
    return patchedExisting
  }

  const separator = patchedExisting.length > 0 && !patchedExisting.endsWith("\n")
    && !patchedExisting.endsWith("\r")
    ? existingDocument.newline
    : ""
  return `${patchedExisting}${separator}${declarations.join(existingDocument.newline)}${existingDocument.newline}`
}
