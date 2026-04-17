import { AppShellCard } from "@/app-shell/components/app-shell-card"
import type { AppShellCardItem } from "@/app-shell/data"

type AppShellContentProps = {
  cards: AppShellCardItem[]
}

function AppShellContent({ cards }: AppShellContentProps) {
  return (
    <div className="min-h-full p-4">
      <div className="grid grid-cols-2 gap-4 min-[1600px]:grid-cols-3 min-[2000px]:grid-cols-4">
        {cards.map((card) => (
          <AppShellCard key={card.title} title={card.title} description={card.description} />
        ))}
      </div>
    </div>
  )
}

export { AppShellContent }
