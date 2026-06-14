import type { ActionRunResult } from "../../action-packages/types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TokenUsageSummary } from "@/components/token-usage-summary"
import { redactSensitiveText } from "@/lib/agent-redaction"

interface DiagnosticsData {
  readonly envKeys?: readonly string[]
  readonly pathSummary?: string
  readonly pathEntries?: readonly string[]
  readonly shell?: string
  readonly args?: readonly string[]
}

function ActionResultView({ result }: { readonly result: ActionRunResult }) {
  const diagnostics = result.status !== "success"
    ? (result.outputs?.diagnostics as DiagnosticsData | undefined)
    : undefined

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {result.summary ? <p className="text-sm text-muted-foreground break-words">{redactSensitiveText(result.summary)}</p> : null}
      {result.metrics ? <MetricsView metrics={result.metrics} /> : null}
      <TokenUsageSummary usage={result.usage} />
      {result.error ? <OutputBlock label="错误" value={result.error} /> : null}
      {result.logs?.map((log) => (
        <OutputBlock key={log.label} label={log.label} value={log.value} />
      ))}
      {diagnostics ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
    </div>
  )
}

function MetricsView({ metrics }: { readonly metrics: NonNullable<ActionRunResult["metrics"]> }) {
  const items = [
    metrics.httpStatus !== undefined ? `HTTP ${String(metrics.httpStatus)}` : undefined,
    metrics.exitCode !== undefined ? `退出码 ${String(metrics.exitCode)}` : undefined,
    metrics.durationMs !== undefined ? `${String(metrics.durationMs)} ms` : undefined,
  ].filter((item): item is string => item !== undefined)

  if (items.length === 0) return null
  return <p className="text-sm text-muted-foreground">{items.join(" · ")}</p>
}

function OutputBlock({ label, value }: { readonly label: string; readonly value: string }) {
  const redactedValue = redactSensitiveText(value)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium">{label}</p>
      <ScrollArea className="max-h-40 rounded-md bg-muted p-2.5" scrollbars="both">
        <pre className="text-xs break-all whitespace-pre-wrap">{redactedValue}</pre>
      </ScrollArea>
    </div>
  )
}

function DiagnosticsBlock({ diagnostics }: { readonly diagnostics: DiagnosticsData }) {
  const lines: string[] = []
  if (diagnostics.pathEntries && diagnostics.pathEntries.length > 0) {
    lines.push(`PATH (${String(diagnostics.pathEntries.length)} entries):`)
    for (const entry of diagnostics.pathEntries) {
      lines.push(`  ${entry}`)
    }
  } else if (diagnostics.pathSummary) {
    lines.push(`PATH: ${diagnostics.pathSummary}`)
  }
  if (diagnostics.envKeys && diagnostics.envKeys.length > 0) {
    lines.push(`\nEnv keys: ${diagnostics.envKeys.join(", ")}`)
  }
  if (diagnostics.shell) {
    const argsStr = diagnostics.args ? ` ${diagnostics.args.join(" ")}` : ""
    lines.push(`Shell: ${diagnostics.shell}${argsStr}`)
  }
  if (lines.length === 0) return null
  return <OutputBlock label="诊断信息" value={lines.join("\n")} />
}

export { ActionResultView }
