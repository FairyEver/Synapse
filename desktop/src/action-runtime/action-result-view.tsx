import type { ActionRunResult } from "../../action-packages/types"

function ActionResultView({ result }: { readonly result: ActionRunResult }) {
  return (
    <div className="flex flex-col gap-3">
      {result.summary ? <p className="text-sm text-muted-foreground">{result.summary}</p> : null}
      {result.metrics ? <MetricsView metrics={result.metrics} /> : null}
      {result.error ? <OutputBlock label="错误" value={result.error} /> : null}
      {result.logs?.map((log) => (
        <OutputBlock key={log.label} label={log.label} value={log.value} />
      ))}
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
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{value}</pre>
    </div>
  )
}

export { ActionResultView }
