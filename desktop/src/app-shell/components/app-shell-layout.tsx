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
          <div className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-3">
            <div aria-hidden="true" className="min-w-0 justify-self-start invisible pointer-events-none">
              {actions ? (
                <div className="shrink-0">
                  {actions}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 justify-center">
              <div className="min-w-0">
                {navigation}
              </div>
            </div>

            {actions ? (
              <div className="min-w-0 justify-self-end">
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
