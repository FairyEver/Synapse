import type { ReactNode } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"

type AppShellLayoutProps = {
  navigation: ReactNode
  children: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ navigation, children, actions }: AppShellLayoutProps) {
  const isMacDesktop = getSynapseBridge()?.platform === "darwin"

  return (
    <main className="h-screen overflow-hidden bg-muted/30">
      <div className="flex h-full flex-col">
        <header className="shrink-0">
          <div
            className={cn(
              "flex min-h-14 items-center gap-4",
              isMacDesktop ? "pr-4 pl-20 [-webkit-app-region:drag]" : "px-4",
            )}
          >
            <div className="flex min-w-0 flex-1 justify-center">
              <div className={cn("min-w-0", isMacDesktop && "[-webkit-app-region:no-drag]")}>
                {navigation}
              </div>
            </div>
            {actions ? (
              <div className={cn("shrink-0", isMacDesktop && "[-webkit-app-region:no-drag]")}>
                {actions}
              </div>
            ) : null}
          </div>
        </header>

        <section className="min-h-0 h-full min-w-0 flex-1 overflow-hidden">
          {children}
        </section>
      </div>
    </main>
  )
}

export { AppShellLayout }
