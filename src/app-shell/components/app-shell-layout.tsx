import type { ReactNode } from "react"
import { getSynapseRuntime } from "@/lib/runtime"
import { cn } from "@/lib/utils"

type AppShellLayoutProps = {
  brand: ReactNode
  navigation: ReactNode
  children: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ brand, navigation, children, actions }: AppShellLayoutProps) {
  const isMacOS = getSynapseRuntime().platform === "darwin"
  const headerInsetClass = isMacOS ? "pt-24" : "pt-[68px]"

  return (
    <main className="relative h-screen overflow-hidden bg-background">
      <div className="flex h-full flex-col">
        <header
          className={cn(
            "app-drag shrink-0 border-b absolute inset-x-0 top-0 z-20 border-border/80 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60",
            isMacOS && "pt-7",
          )}
        >
          <div className="flex min-h-[68px] items-center gap-4 px-4">
            <div className="app-no-drag shrink-0">{brand}</div>
            <div className="app-no-drag min-w-0 flex-1">{navigation}</div>
            {actions ? <div className="app-no-drag shrink-0">{actions}</div> : null}
          </div>
        </header>

        <div className={cn("min-h-0 flex-1 overflow-hidden", headerInsetClass)}>
          <section className="min-h-0 h-full min-w-0 overflow-hidden">
            {children}
          </section>
        </div>
      </div>
    </main>
  )
}

export { AppShellLayout }
