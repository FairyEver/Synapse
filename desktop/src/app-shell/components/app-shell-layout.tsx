import type { ReactNode } from "react"
import { QuickRepositorySwitchDialog } from "@/app-shell/components/quick-repository-switch-dialog"
import { RepoOnboardingDialog } from "@/app-shell/components/repo-onboarding-dialog"
import { SwitchRepositoryOnboardingDialog } from "@/app-shell/components/switch-repository-onboarding-dialog"

type AppShellLayoutProps = {
  dock: ReactNode
  children: ReactNode
  leading?: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ dock, children, leading, actions }: AppShellLayoutProps) {
  return (
    <main className="h-screen overflow-hidden bg-muted/30">
      <RepoOnboardingDialog />
      <QuickRepositorySwitchDialog />
      <SwitchRepositoryOnboardingDialog />
      <div className="flex h-full flex-col">
        <section className="min-h-0 h-full min-w-0 flex-1 overflow-hidden">
          {children}
        </section>

        <footer className="shrink-0 border-t border-sidebar-border/50">
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 px-3">
            <div className="min-w-0">{leading}</div>
            <div className="min-w-0 justify-self-center">{dock}</div>
            {actions && (
              <div className="min-w-0 justify-self-end">
                {actions}
              </div>
            )}
          </div>
        </footer>
      </div>
    </main>
  )
}

export { AppShellLayout }
