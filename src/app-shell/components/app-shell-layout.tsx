import type { ReactNode } from "react"
import { QuickRepositorySwitchDialog } from "@/app-shell/components/quick-repository-switch-dialog"
import { RepoOnboardingDialog } from "@/app-shell/components/repo-onboarding-dialog"
import { SwitchRepositoryOnboardingDialog } from "@/app-shell/components/switch-repository-onboarding-dialog"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"

type AppShellLayoutProps = {
  navigation: ReactNode
  children: ReactNode
  actions?: ReactNode
}

function AppShellLayout({ navigation, children, actions }: AppShellLayoutProps) {
  const isMacDesktop = getSynapseBridge()?.platform === "darwin"
  const noDragClassName = isMacDesktop ? "[-webkit-app-region:no-drag]" : undefined

  return (
    <main
      data-window-drag-context={isMacDesktop ? "true" : undefined}
      className="h-screen overflow-hidden bg-muted/30"
    >
      <RepoOnboardingDialog />
      <QuickRepositorySwitchDialog />
      <SwitchRepositoryOnboardingDialog />
      <div className="flex h-full flex-col">
        <header className="shrink-0">
          <div
            className={cn(
              "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4",
              isMacDesktop ? "pr-4 pl-20 [-webkit-app-region:drag]" : "px-4",
            )}
          >
            <div aria-hidden="true" className="min-w-0 justify-self-start invisible pointer-events-none">
              {actions ? (
                <div className={cn("shrink-0", noDragClassName)}>
                  {actions}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 justify-center">
              <div className={cn("min-w-0", noDragClassName)}>
                {navigation}
              </div>
            </div>

            {actions ? (
              <div className={cn("min-w-0 justify-self-end", noDragClassName)}>
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
