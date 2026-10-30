import type { GameFunding } from "@synapse/shared/game-contracts"
import { Button } from "@/components/ui/button"
export function ModeFilter({ value, onChange, label = "房间类型" }: { value: GameFunding; onChange: (value: GameFunding) => void; label?: string }) {
  return <div className="flex gap-2" role="group" aria-label={label}>
    {([ ["points", "点数"], ["practice", "陪练"] ] as const).map(([mode, text]) => <Button key={mode} type="button" variant={value === mode ? "secondary" : "ghost"} aria-pressed={value === mode} onClick={() => onChange(mode)}>{text}</Button>)}
  </div>
}
