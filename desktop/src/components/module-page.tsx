import type { ReactNode } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { SystemAppTopBar } from "@/modules/apps/components/system-app-top-bar"

type ModulePageProps = {
  readonly title: string
  readonly titleAddon?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly afterContent?: ReactNode
}

function ModulePage({ title, titleAddon, actions, children, afterContent }: ModulePageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <SystemAppTopBar
        left={(
          <>
            <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
            {titleAddon}
          </>
        )}
        leftSlotProps={{ className: "gap-3" }}
        actions={actions}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-h-full px-3 py-3">{children}</div>
      </ScrollArea>
      {afterContent}
    </div>
  )
}

type ModuleContentPanelProps = {
  readonly children: ReactNode
  readonly className?: string
}

function ModuleContentPanel({ children, className }: ModuleContentPanelProps) {
  return (
    <div className={cn("rounded-lg border bg-background", className)}>
      {children}
    </div>
  )
}

export { ModuleContentPanel, ModulePage }
