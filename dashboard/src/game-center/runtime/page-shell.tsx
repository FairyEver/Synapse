import type { ReactNode } from "react"
import { Button } from "../ui/button"
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs"

export function SystemAppTopBarActionButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button variant="ghost" size="sm" onClick={onClick}>{children}</Button>
}
/** Independent browser shell: no Electron chrome, Console navigation or Dock. */
export function SystemAppWindowShell({ children, immersive, left, actions, tabs, value, onValueChange }: {
  children: ReactNode; immersive?: boolean; left?: ReactNode; actions?: ReactNode
  tabs?: { id: string; label: string }[]; value?: string; onValueChange?: (value: string) => void
}) {
  return <div className="game-web-shell" data-game-immersive={immersive || undefined}>
    {!immersive && <header className="game-web-header">
      <div className="game-web-header-title">{left}</div>
      {tabs && <Tabs className="game-web-header-tabs" value={value} onValueChange={onValueChange}>
        <TabsList variant="line">{tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}</TabsList>
      </Tabs>}
      <div className="game-web-header-actions">{actions}</div>
    </header>}
    <main className="game-web-content">{children}</main>
  </div>
}
