import type { ReactNode } from "react"

type AppShellLayoutProps = {
  brand: ReactNode
  navigation: ReactNode
  children: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ brand, navigation, children, actions }: AppShellLayoutProps) {
  return (
    <main className="h-screen overflow-hidden bg-background">
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-border bg-background">
          <div className="flex min-h-[68px] items-center gap-4 px-4">
            <div className="shrink-0">{brand}</div>
            <div className="min-w-0 flex-1">{navigation}</div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
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
