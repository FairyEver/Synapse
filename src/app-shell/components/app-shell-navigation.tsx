import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AppShellTab } from "@/app-shell/data"

type AppShellNavigationProps = {
  tabs: AppShellTab[]
}

function AppShellNavigation({ tabs }: AppShellNavigationProps) {
  const activeTab = tabs.find((tab) => tab.active)?.label ?? tabs[0]?.label

  return (
    <nav className="flex justify-center">
      <Tabs defaultValue={activeTab}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.label} value={tab.label}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  )
}

export { AppShellNavigation }
