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
    <main className="group/app-shell h-screen overflow-hidden bg-muted/30">
      <RepoOnboardingDialog />
      <QuickRepositorySwitchDialog />
      <SwitchRepositoryOnboardingDialog />
      <div className="flex h-full">
        <aside className="flex w-[54px] min-h-0 shrink-0 flex-col items-center border-r border-sidebar-border/50 pt-1 pb-1.5 group-has-[[data-system-app-immersive=true]]/app-shell:hidden">
          {dock}
          {actions && <div className="mt-auto shrink-0 pt-1">{actions}</div>}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <section className="min-h-0 flex-1 overflow-hidden">
            {children}
          </section>
          <footer className="flex min-h-12 shrink-0 items-center border-t border-sidebar-border/50 px-3 empty:hidden group-has-[[data-system-app-immersive=true]]/app-shell:hidden">
            {leading}
          </footer>
        </div>
      </div>
    </main>
  )
}

export { AppShellLayout }
