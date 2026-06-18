import { ArrowLeft, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type EmbeddedSystemAppShellProps = {
  readonly appName: string
  readonly children: ReactNode
  readonly onBack: () => void
  readonly onOpenWindow: () => void
}

function EmbeddedSystemAppShell({
  appName,
  children,
  onBack,
  onOpenWindow,
}: EmbeddedSystemAppShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b bg-background px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="返回应用列表"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <h2 className="truncate text-sm font-semibold">{appName}</h2>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="新窗口打开"
                onClick={onOpenWindow}
              >
                <ExternalLink />
              </Button>
            </TooltipTrigger>
            <TooltipContent>新窗口打开</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}

export { EmbeddedSystemAppShell }
