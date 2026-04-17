import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { AppShellCardItem } from "@/app-shell/data"

type AppShellCardProps = AppShellCardItem

function AppShellCard({ title, description }: AppShellCardProps) {
  return (
    <Card className="h-full bg-gray-50 ring-0">
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm">
            查看
          </Button>
        </CardAction>
        <CardDescription className="min-w-0 truncate">{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export { AppShellCard }
