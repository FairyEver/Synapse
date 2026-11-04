import { skillHubPackageNameSchema, type SkillHubPackageInfo } from "./skill-hub-contracts.js"

const invalid = () => new Error("SKILL.md requires unambiguous string name and description in top-level frontmatter")
const keyLine = /^(?:([\w-]+)|('(?:[^']|'')*')|("(?:[^"\\]|\\.)*"))[ \t]*:(?=[ \t]|$)(.*)$/u
const scalar = /^(?:('(?:[^']|'')*')|("(?:[^"\\]|\\.)*"))(?:[ \t]+#.*)?$/u
const block = /^[>|]-?(?:[ \t]+#.*)?$/u

function quoted(value: string): string {
  if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  try {
    return JSON.parse(value) as string
  } catch {
    throw invalid()
  }
}

function readScalar(value: string): string {
  if (/^['"]/.test(value)) {
    const match = scalar.exec(value)
    if (!match) throw invalid()
    return quoted(match[1] ?? match[2])
  }
  const plain = value.replace(/[ \t]+#.*$/, "").trim()
  if (!plain || /^[&*!|>@`%#[\]{},]|^[?:-](?:\s|$)|:\s|:$/u.test(plain)
    || /^(?:~|null|true|false|[+-]?(?:\.inf|\.nan|\d[\d_]*(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|0x[0-9a-f]+|0o[0-7]+))$/iu.test(plain)) {
    throw invalid()
  }
  return plain
}

function readBlock(lines: string[], start: number, end: number, fold: boolean): string {
  let indent = Infinity
  for (let i = start; i < end; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const spaces = /^ +/.exec(line)?.[0].length ?? 0
    if (!spaces) throw invalid()
    indent = Math.min(indent, spaces)
  }
  const values = lines.slice(start, end).map((line) => line.trim() ? line.slice(indent) : "")
  if (!fold) return values.join("\n")
  let result = ""
  for (let i = 0; i < values.length; i++) {
    const current = values[i]
    const next = values[i + 1]
    result += current
    if (next === undefined) break
    if (!current || /^\s/.test(current) || /^\s/.test(next)) result += "\n"
    else if (next) result += " "
  }
  return result
}

/** Read the installer-compatible scalar subset without rewriting the uploaded document. */
export function readHubSkillFrontmatter(text: string): SkillHubPackageInfo {
  const lines = text.split(/\r?\n/u)
  const end = lines.indexOf("---", 1)
  if (lines[0] !== "---" || end < 0 || !lines.slice(end + 1).some((line) => line.trim())) {
    throw new Error("SKILL.md requires frontmatter and a nonempty body")
  }
  const values = new Map<string, string>()
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim() || /^[ \t#]/u.test(line)) continue
    const entry = keyLine.exec(line)
    if (!entry) {
      // Explicit/merge keys can define an ambiguous effective name or description.
      if (/^(?:[?{\[]|<<:|['"])/u.test(line)) throw invalid()
      continue
    }
    const key = entry[1] ?? quoted(entry[2] ?? entry[3])
    if (key === "<<") throw invalid()
    if (key !== "name" && key !== "description") continue
    if (values.has(key)) throw invalid()
    const raw = entry[4].trim()
    let stop = i + 1
    while (stop < end && (!lines[stop].trim() || /^[ \t]/.test(lines[stop]))) stop++
    if (!block.test(raw) && lines.slice(i + 1, stop).some((item) => item.trim() && !/^\s*#/.test(item))) throw invalid()
    const value = (block.test(raw) ? readBlock(lines, i + 1, stop, raw.startsWith(">")) : readScalar(raw)).trim()
    if (!value || value.includes("\0")) throw invalid()
    values.set(key, value)
    i = stop - 1
  }
  const name = values.get("name")
  const description = values.get("description")
  if (!skillHubPackageNameSchema.safeParse(name).success || !name || !description) throw invalid()
  return { name, description }
}
