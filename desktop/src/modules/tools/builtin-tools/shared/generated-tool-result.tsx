import { CheckCircle2, Copy, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function GeneratedToolResult(props: { readonly result: unknown }) {
  const result = props.result as { readonly ok?: boolean; readonly output?: Record<string, unknown>; readonly error?: { readonly message?: string } }
  if (result.ok === true) {
    const outputPath = typeof result.output?.outputPath === "string" ? result.output.outputPath : null
    const returnedContent = outputPath ? null : returnedText(result.output)
    const warnings = Array.isArray(result.output?.warnings)
      ? result.output.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
      : []
    return (
      <div className="grid gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 />
          完成
          <Badge variant="secondary">成功</Badge>
        </div>
        {outputPath ? <p className="truncate text-sm text-muted-foreground" title={outputPath}>{outputPath}</p> : null}
        {returnedContent ? (
          <div className="grid gap-2">
            <Textarea readOnly className="min-h-40 resize-y font-mono text-xs" value={returnedContent} />
            <Button type="button" variant="outline" className="w-fit" onClick={() => void copyResult(returnedContent)}>
              <Copy data-icon="inline-start" />
              复制结果
            </Button>
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="grid gap-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">警告</p>
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
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

function returnedText(output: Record<string, unknown> | undefined): string | null {
  if (typeof output?.markdown === "string" && output.markdown.length > 0) return output.markdown
  if (typeof output?.text === "string" && output.text.length > 0) return output.text
  return null
}

async function copyResult(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
    toast.success("已复制")
  } catch {
    toast.error("复制失败")
  }
}
