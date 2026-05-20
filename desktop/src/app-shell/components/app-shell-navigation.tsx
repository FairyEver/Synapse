import { ScrollArea } from "@/components/ui/scroll-area"
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
    <nav className="flex min-w-0 justify-start overflow-hidden">
      <ScrollArea className="min-w-0 max-w-full" scrollbars="horizontal">
        <Tabs
          data-track="app-shell-navigation"
          value={value}
          onValueChange={onValueChange}
          className="min-w-max"
        >
          <TabsList className="shrink-0">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </ScrollArea>
    </nav>
  )
}

export { AppShellNavigation, type AppShellNavigationTab }
