import type { ReactNode } from "react"
import { Button, Tabs } from "@heroui/react"
import { track } from "./tracking"

export function SystemAppTopBarActionButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button variant="tertiary" onPress={onClick}>{children}</Button>
}
/** Independent browser shell: game routes do not load Console navigation. */
export function SystemAppWindowShell({ children, immersive, left, actions, tabs, value, onValueChange }: {
  children: ReactNode; immersive?: boolean; left?: ReactNode; actions?: ReactNode
  tabs?: { id: string; label: string }[]; value?: string; onValueChange?: (value: string) => void
}) {
  return <div className="game-web-shell" data-game-immersive={immersive || undefined}
    onClickCapture={event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-slot="button"]') : null
      if (button && !button.disabled) track({ component: "button", action: "click", eventKey: button.dataset.track })
    }}
    onChangeCapture={event => {
      const target = event.target
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
      if (!target.disabled) track({ component: target instanceof HTMLInputElement && target.type === "radio" ? "radio-group" : "input", action: "change" })
    }}>
    {!immersive && <header className="game-web-header">
      <div className="game-web-header-title min-w-0 font-semibold">{left}</div>
      {tabs && <Tabs selectedKey={value} onSelectionChange={key => onValueChange?.(String(key))} className="mx-auto">
        <Tabs.ListContainer>
          <Tabs.List className="w-max" aria-label="游戏页面">{tabs.map(tab => <Tabs.Tab className="whitespace-nowrap" key={tab.id} id={tab.id}>{tab.label}<Tabs.Indicator /></Tabs.Tab>)}</Tabs.List>
        </Tabs.ListContainer>
      </Tabs>}
      <div className="game-web-header-actions ms-auto flex items-center gap-2">{actions}</div>
    </header>}
    <main className="game-web-content">{children}</main>
  </div>
}
