import { useState } from "react"
import { Button } from "../../../src/components/ui/button"
import { Loader2, Play } from "lucide-react"
import { httpRequestActionConfigSchema, type HttpRequestActionConfig } from "./schema"

interface HttpTestResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly durationMs: number
}

export function RequestTester({ config }: { readonly config: HttpRequestActionConfig }) {
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<HttpTestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const handleTest = async () => {
    setLoading(true)
    setError(null)
    setResponse(null)
    setExpanded(true)
    try {
      const parsed = httpRequestActionConfigSchema.safeParse(config)
      if (!parsed.success) {
        setError(parsed.error.issues.map((issue) => issue.message).join("；"))
        return
      }
      const bridge = (window as unknown as { synapse: { http: { testRequest: (c: HttpRequestActionConfig) => Promise<HttpTestResponse> } } }).synapse
      const res = await bridge.http.testRequest(parsed.data)
      setResponse(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs gap-1"
        onClick={handleTest}
        disabled={loading}
      >
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
        {loading ? "发送中…" : "发送测试"}
      </Button>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-2">
          <p className="text-xs text-destructive font-medium">请求失败</p>
          <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
        </div>
      )}

      {response && (
        <div className="rounded border p-2">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left"
            onClick={() => setExpanded(!expanded)}
          >
            <span className={`text-xs font-mono font-medium ${response.status >= 400 ? "text-destructive" : response.status >= 300 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
              {response.status} {response.statusText}
            </span>
            <span className="text-xs text-muted-foreground">· {response.durationMs}ms</span>
          </button>
          {expanded && response.body && (
            <pre className="mt-1 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {formatResponseBody(response.body)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function formatResponseBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
