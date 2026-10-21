import { createParser, type LibraryJSONSchema } from "@openuidev/lang-core"
import librarySpec from "./generated-ui-library.json"
import { GENERATED_UI_MAX_SOURCE_BYTES } from "../types/agent-generated-ui"

export type GeneratedUiContentPart =
  | { kind: "markdown"; content: string }
  | { kind: "openui"; content: string; ordinal: number; complete: boolean }

/** Recognize only explicit, unindented fences, outside every other code fence. */
export function splitGeneratedUiContent(content: string, streaming = false): GeneratedUiContentPart[] {
  const parts: GeneratedUiContentPart[] = []
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let markdown = ""
  let code = ""
  let fence: { marker: string; length: number; ui: boolean } | undefined
  let ordinal = 0
  const flush = () => { if (markdown) parts.push({ kind: "markdown", content: markdown }); markdown = "" }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const trimmed = line.replace(/\r?\n$/, "")
    if (!fence) {
      if (streaming && index === lines.length - 1 && !line.endsWith("\n") && ["```openui", "```openui-lang", "~~~openui", "~~~openui-lang"].some((tag) => tag.startsWith(trimmed))) break
      const match = /^(\`{3,}|~{3,})([^\r\n]*)$/.exec(trimmed)
      if (match) {
        const ui = /^(?:openui|openui-lang)$/.test(match[2].trim())
        fence = { marker: match[1][0], length: match[1].length, ui }
        if (ui) { flush(); code = "" } else markdown += line
      } else markdown += line
    } else if (new RegExp(`^${fence.marker}{${fence.length},}\\s*$`).test(trimmed)) {
      if (fence.ui) parts.push({ kind: "openui", content: code, ordinal: ordinal++, complete: true })
      else markdown += line
      fence = undefined
    } else if (fence.ui) code += line
    else markdown += line
  }
  if (fence?.ui) parts.push({ kind: "openui", content: code, ordinal, complete: false })
  flush()
  return parts
}

const parser = createParser(librarySpec.schema as unknown as LibraryJSONSchema, "Stack")
const MAX_STATEMENTS = 500
const FORBIDDEN_COMPONENTS = new Set(["Modal", "MarkDownRenderer", "InlineMarkdownRenderer", "ImageBlock", "ImageGallery", "ImageText", "ImageTextLarge", "VisualCardItem", "VisualCardBlock", "Sources", "SourceFaviconImage", "Citation"])

/** The official parser drops invalid optional layout props and uses component defaults.
 * Never extend this allowance to data, fields, resources or action parameters. */
export function isRecoverableGeneratedUiError(error: { code: string; component?: string; path?: string }): boolean {
  return error.code === "type-mismatch" && error.component === "Stack"
    && ["/direction", "/gap", "/align", "/justify", "/wrap"].includes(error.path ?? "")
}

function formatGeneratedUiError(error: { code: string; component?: string; path?: string; statementId?: string }): string {
  // Parser messages can echo user data. Only bounded identifiers belong in diagnostics.
  const identifier = (value?: string) => value && /^[\w$./-]{1,80}$/.test(value) ? value : ""
  const location = [identifier(error.statementId), [identifier(error.component), identifier(error.path)?.replace(/^\//, "")].filter(Boolean).join(".")].filter(Boolean).join(" · ")
  return `界面格式无效${location ? `（${location}）` : ""}。`
}

/** Also runs on evaluated props, including restored bindings and later reactive updates. */
export function hasUnsafeGeneratedUiResource(value: unknown): boolean {
  let nodes = 0
  const heights = new WeakMap<object, number>()
  const active = new WeakSet<object>()
  // References share AST objects. Cache inspected subtree heights so repeated
  // datasets do not exhaust the budget, while deeper reuse still checks depth.
  const inspect = (child: unknown, depth: number): number => {
    if (depth > 32 || ++nodes > 10_000) return -1
    if (typeof child === "string") return /!\s*\[|<\s*(?:img|iframe|video|audio|object|embed|svg)\b/i.test(child) ? -1 : 0
    if (!child || typeof child !== "object") return 0
    const cachedHeight = heights.get(child)
    if (cachedHeight !== undefined) return depth + cachedHeight > 32 ? -1 : cachedHeight
    if (active.has(child)) return -1
    active.add(child)
    const item = child as Record<string, unknown>
    if (typeof item.typeName === "string" && FORBIDDEN_COMPONENTS.has(item.typeName)) return -1
    if (item.typeName === "Image") {
      const props = item.props as Record<string, unknown> | undefined
      if (!props || !Object.values(props).some((v) => typeof v === "string" && v.startsWith("synapse-agent-artifact://local/"))) return -1
    }
    let height = 0
    for (const [key, entry] of Object.entries(item)) {
      if (/^(src|imageUrl|image|avatar|favicon|backgroundImage)$/i.test(key) && typeof entry === "string" && entry && !entry.startsWith("synapse-agent-artifact://local/")) return -1
      const childHeight = inspect(entry, depth + 1)
      if (childHeight < 0) return -1
      height = Math.max(height, childHeight + 1)
    }
    active.delete(child)
    heights.set(child, height)
    return height
  }
  return inspect(value, 0) < 0
}

/** Mask literals before checking executable identifiers; preserve offsets/newlines. */
function executableText(source: string): string {
  return source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*/g, (literal) => literal.replace(/[^\n]/g, " "))
}

function hasReferenceCycle(source: string): boolean {
  const assignments = [...source.matchAll(/^\s*([\w$]+)\s*=([^]*?)(?=^\s*[\w$]+\s*=|$(?![^]))/gm)]
  const names = new Set(assignments.map((match) => match[1]))
  const dependencies = new Map(assignments.map((match) => [match[1], [...match[2].matchAll(/[\w$]+/g)].map((token) => token[0]).filter((name) => names.has(name))]))
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (name: string): boolean => {
    if (active.has(name)) return true
    if (visited.has(name)) return false
    active.add(name)
    for (const child of dependencies.get(name) ?? []) if (visit(child)) return true
    active.delete(name); visited.add(name)
    return false
  }
  return [...names].some(visit)
}

export function validateGeneratedUiSource(source: string, streaming = false): string | null {
  if (new TextEncoder().encode(source).byteLength > GENERATED_UI_MAX_SOURCE_BYTES) return "界面内容过大。"
  const executable = executableText(source)
  // TextContent also renders Markdown internally; image syntax can otherwise bypass Image checks.
  if (/!\s*\[|<\s*(?:img|iframe|video|audio|object|embed|svg)\b/i.test(source)) return "界面不能自动加载外部资源。"
  for (const image of executable.matchAll(/\bImage\s*\(/g)) {
    if (!/^\s*"synapse-agent-artifact:\/\/local\/[^"]+"\s*(?:,|\))/.test(source.slice(image.index! + image[0].length))) return "界面图片必须使用受控资源。"
  }
  if (/\b(?:Query|Mutation)\s*\(|@Run\s*\(/.test(executable)) return "界面不能直接调用工具。"
  if ([...executable.matchAll(/\b(\w+)\s*\(/g)].some((match) => FORBIDDEN_COMPONENTS.has(match[1]))) return "界面包含不支持的组件。"
  let nesting = 0
  for (const char of executable) {
    if ("([{".includes(char) && ++nesting > 64) return "界面层级过深。"
    if (")]}".includes(char)) nesting--
  }
  if ([...executable.matchAll(/^\s*[\w$]+\s*=/gm)].length > MAX_STATEMENTS || hasReferenceCycle(executable)) return "界面包含过多内容或循环引用。"
  try {
    const result = parser.parse(source)
    if (result.rootExpression) return "界面根节点必须使用 Stack。"
    if (result.queryStatements.length || result.mutationStatements.length) return "界面不能直接调用工具。"
    if (hasUnsafeGeneratedUiResource(result.root)) return "界面包含不支持的资源或层级。"
    const fatalError = result.meta.errors.find((error) => error.code !== "no-root" && !isRecoverableGeneratedUiError(error))
    if (!streaming && fatalError) return formatGeneratedUiError(fatalError)
    if (!streaming && (!result.root || result.meta.incomplete || result.meta.unresolved.length)) return "界面格式无效。"
    return null
  } catch {
    return streaming ? null : "界面格式无效。"
  }
}
