import type { ReactNode } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"

type SidebarContentLayoutProps = {
  sidebar: ReactNode
  children: ReactNode
  className?: string
  containerClassName?: string
  sidebarClassName?: string
  contentClassName?: string
  contentScrollable?: boolean
}

function SidebarContentLayout({
  sidebar,
  children,
  className,
  containerClassName,
  sidebarClassName,
  contentClassName,
  contentScrollable = true,
}: SidebarContentLayoutProps) {
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className={cn("h-full min-h-0 w-full overflow-hidden", containerClassName, className)}
    >
      <ResizablePanel
        defaultSize={280}
        minSize={220}
        maxSize={420}
        groupResizeBehavior="preserve-pixel-size"
      >
        <div
          data-window-no-drag="true"
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden bg-background px-4 py-5",
            sidebarClassName,
          )}
        >
          {sidebar}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel>
        <div
          data-window-no-drag="true"
          className={cn(
            "h-full min-h-0 min-w-0 bg-background px-6 py-5",
            contentScrollable ? "overflow-y-auto" : "overflow-hidden",
            contentClassName,
          )}
        >
          <div
            className={cn(
              "h-full min-h-0 min-w-0",
              contentScrollable ? undefined : "overflow-hidden",
            )}
          >
            {children}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export { SidebarContentLayout }
