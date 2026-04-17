import { AppShellCard } from "@/app-shell/components/app-shell-card"
import type { AppShellCardItem } from "@/app-shell/data"

type AppShellContentProps = {
  cards: AppShellCardItem[]
}

function AppShellContent({ cards }: AppShellContentProps) {
  const middleIndex = Math.ceil(cards.length / 2)
  const leftColumnCards = cards.slice(0, middleIndex)
  const rightColumnCards = cards.slice(middleIndex)

  return (
    <div className="h-full p-4">
      <div className="grid h-full gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          {leftColumnCards.map((card) => (
            <AppShellCard key={card.title} title={card.title} description={card.description} />
          ))}
        </div>
        <div className="space-y-4">
          {rightColumnCards.map((card) => (
            <AppShellCard key={card.title} title={card.title} description={card.description} />
          ))}
        </div>
      </div>
    </div>
  )
}

export { AppShellContent }
