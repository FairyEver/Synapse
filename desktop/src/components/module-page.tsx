import type { ReactNode } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"

type ModulePageProps = {
  readonly title: string
  readonly titleAddon?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly afterContent?: ReactNode
}

function ModulePage({ title, titleAddon, actions, children, afterContent }: ModulePageProps) {
  return (
    <SystemAppWindowShell
      left={(
        <>
          <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
          {titleAddon}
        </>
      )}
      embeddedLeftAddon={titleAddon}
      actions={actions}
    >
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <ScrollArea className="min-h-0 flex-1">
          <div className="min-h-full px-3 py-3">{children}</div>
        </ScrollArea>
        {afterContent}
      </div>
    </SystemAppWindowShell>
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
