import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type AppShellNavigationTab = {
  id: string
  label: string
}

type AppShellNavigationProps = {
  tabs: AppShellNavigationTab[]
  value: string
  onValueChange: (value: string) => void
}

function AppShellNavigation({ tabs, value, onValueChange }: AppShellNavigationProps) {
  return (
    <nav className="flex min-w-0 justify-start overflow-x-auto">
      <Tabs
        data-track="app-shell-navigation"
        value={value}
        onValueChange={onValueChange}
        className="min-w-0"
      >
        <TabsList className="shrink-0">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  )
}

export { AppShellNavigation, type AppShellNavigationTab }
