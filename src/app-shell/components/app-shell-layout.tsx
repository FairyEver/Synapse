import type { ReactNode } from "react"
import { getSynapseRuntime } from "@/lib/runtime"
import { cn } from "@/lib/utils"

type AppShellLayoutProps = {
  brand: ReactNode
  navigation: ReactNode
  sidebar: ReactNode
  children: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ brand, navigation, sidebar, children, actions }: AppShellLayoutProps) {
  const isMacOS = getSynapseRuntime().platform === "darwin"

  return (
    <main className="min-h-screen">
      <div className="flex min-h-screen flex-col">
        <header className={cn("app-drag border-b", isMacOS && "pt-7")}>
          <div className="flex min-h-[68px] items-center gap-4 px-4">
            <div className="app-no-drag shrink-0">{brand}</div>
            <div className="app-no-drag min-w-0 flex-1">{navigation}</div>
            {actions ? <div className="app-no-drag shrink-0">{actions}</div> : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="border-b lg:w-[290px] lg:shrink-0 lg:border-r lg:border-b-0">
            {sidebar}
          </aside>
          <section className="min-w-0 flex-1">{children}</section>
        </div>
      </div>
    </main>
  )
}

export { AppShellLayout }
