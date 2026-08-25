import { useMemo } from "react"
import { WrapText } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { isBinaryGitDiff } from "../lib/git-diff-sections"

export type GitDiffViewMode = "unified" | "split"

type GitDiffViewerProps = {
  readonly path: string
  readonly originalPath?: string | null
  readonly statusLabel?: string
  readonly text: string
  readonly binary?: boolean
  readonly truncated?: boolean
  readonly mode: GitDiffViewMode
  readonly wrap: boolean
  readonly onModeChange: (mode: GitDiffViewMode) => void
  readonly onWrapChange: (wrap: boolean) => void
}

type DiffLineKind = "meta" | "hunk" | "context" | "addition" | "deletion"
type ParsedDiffLine = {
  readonly key: string
  readonly kind: DiffLineKind
  readonly content: string
  readonly oldNumber?: number
  readonly newNumber?: number
}
type SplitDiffRow =
  | { readonly kind: "full"; readonly line: ParsedDiffLine }
  | { readonly kind: "pair"; readonly left?: ParsedDiffLine; readonly right?: ParsedDiffLine }

export function GitDiffViewer({
  path,
  originalPath = null,
  statusLabel,
  text,
  binary = false,
  truncated = false,
  mode,
  wrap,
  onModeChange,
  onWrapChange,
}: GitDiffViewerProps) {
  const lines = useMemo(() => parseUnifiedDiff(text), [text])
  return (
    <div className="grid min-w-0 bg-background">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium" title={path}>{path}</span>
          {statusLabel ? <Badge variant="outline">{statusLabel}</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            type="single"
            value={mode}
            variant="outline"
            size="sm"
            aria-label="差异布局"
            data-track="git-diff-layout"
            onValueChange={(value) => {
              if (value === "unified" || value === "split") onModeChange(value)
            }}
          >
            <ToggleGroupItem value="unified" aria-label="统一视图">统一</ToggleGroupItem>
            <ToggleGroupItem value="split" aria-label="分栏视图">分栏</ToggleGroupItem>
          </ToggleGroup>
          <Toggle
            variant="outline"
            size="sm"
            pressed={wrap}
            aria-label="自动换行"
            data-track="git-diff-wrap"
            onPressedChange={onWrapChange}
          >
            <WrapText />
            换行
          </Toggle>
        </div>
      </div>
      {truncated ? (
        <div className="p-4 pb-0">
          <Alert>
            <AlertTitle>差异内容已截断</AlertTitle>
            <AlertDescription>内容过大，仅显示前 2 MiB。</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {binary || isBinaryGitDiff(text) ? (
        <div className="p-4 text-sm text-muted-foreground">文件已变更。</div>
      ) : text ? (
        <div className="min-w-0 overflow-x-auto" data-allow-select="true">
          <div
            role="table"
            aria-label={`${originalPath ?? path} 与 ${path} 的差异`}
            className="min-w-full font-mono text-xs leading-5 text-foreground"
            data-component="git-diff-view"
            data-mode={mode}
          >
            {mode === "split"
              ? <SplitDiff lines={lines} wrap={wrap} />
              : <UnifiedDiff lines={lines} wrap={wrap} />}
          </div>
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">没有文本差异。</div>
      )}
    </div>
  )
}

function UnifiedDiff({ lines, wrap }: { readonly lines: readonly ParsedDiffLine[]; readonly wrap: boolean }) {
  return lines.map((line) => (
    <div
      key={line.key}
      role="row"
      className={cn(
        "grid min-w-full border-b last:border-b-0",
        wrap
          ? "grid-cols-[3.25rem_3.25rem_minmax(0,1fr)]"
          : "grid-cols-[3.25rem_3.25rem_minmax(max-content,1fr)]",
        diffLineBackground(line.kind),
      )}
    >
      <LineNumber value={line.oldNumber} />
      <LineNumber value={line.newNumber} />
      <DiffCode line={line} wrap={wrap} />
    </div>
  ))
}

function SplitDiff({ lines, wrap }: { readonly lines: readonly ParsedDiffLine[]; readonly wrap: boolean }) {
  return splitDiffRows(lines).map((row, index) => {
    if (row.kind === "full") {
      return (
        <div
          key={row.line.key}
          role="row"
          className={cn(
            "grid min-w-full border-b",
            wrap ? "grid-cols-[3.25rem_minmax(0,1fr)]" : "grid-cols-[3.25rem_minmax(max-content,1fr)]",
            diffLineBackground(row.line.kind),
          )}
        >
          <LineNumber value={row.line.oldNumber ?? row.line.newNumber} />
          <DiffCode line={row.line} wrap={wrap} />
        </div>
      )
    }
    return (
      <div key={`pair:${index}`} role="row" className="grid min-w-full grid-cols-2 border-b last:border-b-0">
        <SplitPane line={row.left} pairedLine={row.right} wrap={wrap} />
        <SplitPane line={row.right} pairedLine={row.left} wrap={wrap} right />
      </div>
    )
  })
}

function SplitPane({
  line,
  pairedLine,
  wrap,
  right = false,
}: {
  readonly line?: ParsedDiffLine
  readonly pairedLine?: ParsedDiffLine
  readonly wrap: boolean
  readonly right?: boolean
}) {
  return (
    <div className={cn(
      "grid min-w-0",
      wrap ? "grid-cols-[3.25rem_minmax(0,1fr)]" : "grid-cols-[3.25rem_minmax(max-content,1fr)]",
      right && "border-l",
      line && diffLineBackground(line.kind),
    )}>
      <LineNumber value={right ? line?.newNumber : line?.oldNumber} />
      {line
        ? <DiffCode line={line} pairedLine={pairedLine} wrap={wrap} />
        : <span aria-hidden="true" className="bg-muted/30" />}
    </div>
  )
}

function LineNumber({ value }: { readonly value?: number }) {
  return (
    <span role="cell" className="select-none border-r bg-muted/50 px-2 text-right tabular-nums text-muted-foreground">
      {value ?? ""}
    </span>
  )
}

function DiffCode({
  line,
  pairedLine,
  wrap,
}: {
  readonly line: ParsedDiffLine
  readonly pairedLine?: ParsedDiffLine
  readonly wrap: boolean
}) {
  const marker = line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "
  return (
    <span
      role="cell"
      className={cn(
        "min-w-0 px-2",
        wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        line.kind === "meta" && "text-muted-foreground",
        line.kind === "hunk" && "font-medium text-foreground",
      )}
    >
      {line.kind === "meta" || line.kind === "hunk"
        ? line.content
        : <>{marker}{renderIntralineChange(line, pairedLine)}</>}
    </span>
  )
}

function renderIntralineChange(line: ParsedDiffLine, pairedLine: ParsedDiffLine | undefined) {
  if (!pairedLine || !isChangedLinePair(line, pairedLine)) return line.content
  const [prefix, changed, suffix] = changedSegments(line.content, pairedLine.content)
  if (!changed) return line.content
  return (
    <>
      {prefix}
      <mark className={cn("text-inherit", line.kind === "addition" ? "bg-primary/15" : "bg-destructive/20")}>{changed}</mark>
      {suffix}
    </>
  )
}

function isChangedLinePair(line: ParsedDiffLine, pairedLine: ParsedDiffLine): boolean {
  return (line.kind === "addition" && pairedLine.kind === "deletion")
    || (line.kind === "deletion" && pairedLine.kind === "addition")
}

function changedSegments(value: string, counterpart: string): readonly [string, string, string] {
  let prefixLength = 0
  const prefixLimit = Math.min(value.length, counterpart.length)
  while (prefixLength < prefixLimit && value[prefixLength] === counterpart[prefixLength]) prefixLength += 1
  let suffixLength = 0
  const suffixLimit = Math.min(value.length - prefixLength, counterpart.length - prefixLength)
  while (
    suffixLength < suffixLimit
    && value[value.length - suffixLength - 1] === counterpart[counterpart.length - suffixLength - 1]
  ) suffixLength += 1
  return [
    value.slice(0, prefixLength),
    value.slice(prefixLength, suffixLength === 0 ? value.length : value.length - suffixLength),
    suffixLength === 0 ? "" : value.slice(value.length - suffixLength),
  ]
}

function diffLineBackground(kind: DiffLineKind): string {
  if (kind === "addition") return "bg-primary/5"
  if (kind === "deletion") return "bg-destructive/10"
  if (kind === "hunk") return "bg-muted"
  return "bg-background"
}

function parseUnifiedDiff(text: string): readonly ParsedDiffLine[] {
  const lines = text.replace(/\n$/, "").split("\n")
  let oldNumber: number | undefined
  let newNumber: number | undefined
  return lines.map((rawLine, index) => {
    const key = `${index}:${rawLine}`
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
    if (hunk) {
      oldNumber = Number(hunk[1])
      newNumber = Number(hunk[2])
      return { key, kind: "hunk", content: rawLine }
    }
    if (oldNumber === undefined || newNumber === undefined || isDiffMetadataLine(rawLine)) {
      return { key, kind: "meta", content: rawLine }
    }
    if (rawLine.startsWith("+")) {
      const line = { key, kind: "addition" as const, content: rawLine.slice(1), newNumber }
      newNumber += 1
      return line
    }
    if (rawLine.startsWith("-")) {
      const line = { key, kind: "deletion" as const, content: rawLine.slice(1), oldNumber }
      oldNumber += 1
      return line
    }
    if (rawLine.startsWith(" ")) {
      const line = { key, kind: "context" as const, content: rawLine.slice(1), oldNumber, newNumber }
      oldNumber += 1
      newNumber += 1
      return line
    }
    return { key, kind: "meta", content: rawLine }
  })
}

function isDiffMetadataLine(line: string): boolean {
  return line.startsWith("diff --git ")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
    || line.startsWith("new file mode ")
    || line.startsWith("deleted file mode ")
    || line.startsWith("similarity index ")
    || line.startsWith("rename from ")
    || line.startsWith("rename to ")
    || line === "\\ No newline at end of file"
}

function splitDiffRows(lines: readonly ParsedDiffLine[]): readonly SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line) break
    if (line.kind === "meta" || line.kind === "hunk") {
      rows.push({ kind: "full", line })
      index += 1
      continue
    }
    if (line.kind === "context") {
      rows.push({ kind: "pair", left: line, right: line })
      index += 1
      continue
    }
    const deletions: ParsedDiffLine[] = []
    while (lines[index]?.kind === "deletion") {
      deletions.push(lines[index]!)
      index += 1
    }
    const additions: ParsedDiffLine[] = []
    while (lines[index]?.kind === "addition") {
      additions.push(lines[index]!)
      index += 1
    }
    if (deletions.length === 0 && additions.length === 0) {
      rows.push({ kind: "full", line })
      index += 1
      continue
    }
    const pairCount = Math.max(deletions.length, additions.length)
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      rows.push({ kind: "pair", left: deletions[pairIndex], right: additions[pairIndex] })
    }
  }
  return rows
}

export function GitRawDiff({ text, parseFailed = false }: { readonly text: string; readonly parseFailed?: boolean }) {
  return (
    <div className="grid min-w-0 gap-3 p-4">
      {parseFailed ? (
        <Alert>
          <AlertTitle>无法格式化差异</AlertTitle>
          <AlertDescription>已显示原始内容。</AlertDescription>
        </Alert>
      ) : null}
      <pre className="block w-full min-w-0 max-w-full overflow-x-auto bg-muted p-3 text-xs leading-relaxed text-foreground" data-allow-select="true">
        {text || "没有文本差异。"}
      </pre>
    </div>
  )
}
