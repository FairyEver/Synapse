import { AppBrand } from "@/app-shell/components/app-brand"
import { AppShellActions } from "@/app-shell/components/app-shell-actions"
import { AppShellContent } from "@/app-shell/components/app-shell-content"
import { AppShellLayout } from "@/app-shell/components/app-shell-layout"
import { AppShellNavigation } from "@/app-shell/components/app-shell-navigation"
import { AppShellSidebar } from "@/app-shell/components/app-shell-sidebar"
import { appShellCards, appShellSidebarGroups, appShellTabs } from "@/app-shell/data"

function App() {
  return (
    <AppShellLayout
      brand={<AppBrand />}
      navigation={<AppShellNavigation tabs={appShellTabs} />}
      actions={<AppShellActions />}
      sidebar={<AppShellSidebar groups={appShellSidebarGroups} />}
    >
      <AppShellContent cards={appShellCards} />
    </AppShellLayout>
  )
}

export default App
