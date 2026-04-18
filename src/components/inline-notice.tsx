import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type InlineNoticeProps = {
  message: string
  onDismiss?: () => void
  tone?: "default" | "destructive"
}

function InlineNotice({ message, onDismiss, tone = "default" }: InlineNoticeProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2",
        tone === "destructive"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-border bg-muted/20 text-foreground",
      )}
    >
      <p className="text-sm">{message}</p>
      {onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={tone === "destructive" ? "text-destructive hover:text-destructive" : undefined}
          onClick={onDismiss}
        >
          <X />
          关闭
        </Button>
      ) : null}
    </div>
  )
}

export { InlineNotice }
