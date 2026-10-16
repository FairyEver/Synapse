import { ChevronDown, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

export function DriveSyncCopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast("已复制")
    } catch {
      toast("复制失败，请选择文本后复制。")
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={() => {
        void copy()
      }}
    >
      <Copy />
    </Button>
  )
}

export function DriveSyncDiagnostics({
  messages,
  attempts,
}: {
  readonly messages: readonly string[]
  readonly attempts?: number
}) {
  const unique = [...new Set(messages.map((message) => message.trim()).filter(Boolean))]
  if (unique.length === 0 && !attempts) return null
  const content = [...(attempts ? [`已尝试 ${attempts} 次`] : []), ...unique].join("\n\n")
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="group text-muted-foreground">
          技术详情
          <ChevronDown
            data-icon="inline-end"
            className="transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex items-start gap-2 py-2">
          <pre
            data-allow-select="true"
            className="max-h-48 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
          >
            {content}
          </pre>
          <DriveSyncCopyButton value={content} label="复制技术详情" />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
