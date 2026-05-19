import type { MouseEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createRendererLogger } from "@/app-shell/logging"
import { cn } from "@/lib/utils"
import { errorDiagnostic } from "../lib/error-utils"

const logger = createRendererLogger("workflow.copy-id")

type CopyIdKind = "workflow" | "node"

interface CopyIdButtonProps {
  id: string
  kind: CopyIdKind
  className?: string
}

const LABELS: Record<CopyIdKind, string> = {
  workflow: "工作流",
  node: "节点",
}

export function CopyIdButton({ id, kind, className }: CopyIdButtonProps) {
  const label = LABELS[kind]

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (!navigator.clipboard?.writeText) {
      toast("复制失败")
      return
    }

    void navigator.clipboard.writeText(id).then(() => {
      toast("ID 已复制")
    }).catch((err: unknown) => {
      logger.warn("Workflow id copy failed.", {
        boundary: "renderer.workflow.copy-id",
        kind,
        id,
        ...errorDiagnostic(err),
      })
      toast("复制失败")
    })
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-label={`复制${label} ID`}
      data-track={`workflow-${kind}-copy-id`}
      className={cn(
        "h-5 max-w-full justify-start px-1.5 font-mono text-[11px] font-normal text-muted-foreground",
        className,
      )}
      onClick={handleCopy}
    >
      <span className="shrink-0 font-sans">ID</span>
      <span className="truncate">{id}</span>
    </Button>
  )
}
