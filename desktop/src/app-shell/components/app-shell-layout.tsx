import type { ReactNode } from "react"
import { QuickRepositorySwitchDialog } from "@/app-shell/components/quick-repository-switch-dialog"
import { RepoOnboardingDialog } from "@/app-shell/components/repo-onboarding-dialog"
import { SwitchRepositoryOnboardingDialog } from "@/app-shell/components/switch-repository-onboarding-dialog"

type AppShellLayoutProps = {
  navigation: ReactNode
  children: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ navigation, children, actions }: AppShellLayoutProps) {
  return (
    <main className="h-screen overflow-hidden bg-muted/30">
      <RepoOnboardingDialog />
      <QuickRepositorySwitchDialog />
      <SwitchRepositoryOnboardingDialog />
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-sidebar-border/50">
          <div className="flex min-h-10 items-center justify-between gap-3 px-3">
            <div className="min-w-0 flex-1">{navigation}</div>
            {actions && (
              <div className="shrink-0">
                {actions}
              </div>
            )}
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
