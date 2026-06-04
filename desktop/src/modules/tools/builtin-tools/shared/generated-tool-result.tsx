import { CheckCircle2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"

export function GeneratedToolResult(props: { readonly result: unknown }) {
  const result = props.result as { readonly ok?: boolean; readonly output?: Record<string, unknown>; readonly error?: { readonly message?: string } }
  if (result.ok === true) {
    const outputPath = typeof result.output?.outputPath === "string" ? result.output.outputPath : null
    return (
      <div className="grid gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 />
          完成
          <Badge variant="secondary">成功</Badge>
        </div>
        {outputPath ? <p className="truncate text-sm text-muted-foreground" title={outputPath}>{outputPath}</p> : null}
      </div>
    )
  }
  if (result.ok === false) {
    return (
      <div className="grid gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <XCircle />
          失败
          <Badge variant="destructive">错误</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{result.error?.message ?? "运行失败"}</p>
      </div>
    )
  }
  return null
}

