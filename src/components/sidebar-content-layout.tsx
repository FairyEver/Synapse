import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type SidebarContentLayoutProps = {
  sidebar: ReactNode
  children: ReactNode
  className?: string
  containerClassName?: string
  sidebarClassName?: string
  contentClassName?: string
}

function SidebarContentLayout({
  sidebar,
  children,
  className,
  containerClassName,
  sidebarClassName,
  contentClassName,
}: SidebarContentLayoutProps) {
  return (
    <div className={cn("h-full overflow-hidden p-6", className)}>
      <div
        className={cn(
          "mx-auto grid h-full max-w-6xl gap-6 md:grid-cols-[280px_minmax(0,1fr)]",
          containerClassName,
        )}
      >
        <div className={cn("min-h-0", sidebarClassName)}>{sidebar}</div>
        <div className={cn("min-h-0 min-w-0", contentClassName)}>{children}</div>
      </div>
    </div>
  )
}

export { SidebarContentLayout }
