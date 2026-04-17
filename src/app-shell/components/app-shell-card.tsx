import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { AppShellCardItem } from "@/app-shell/data"

type AppShellCardProps = AppShellCardItem

function AppShellCard({ title, description }: AppShellCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm">
            查看
          </Button>
        </CardAction>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export { AppShellCard }
