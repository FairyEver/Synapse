import { Label, Radio, RadioGroup } from "@heroui/react"
import type { PokerCardChoiceSpec } from "@synapse/shared/game-contracts"

export function PokerCardSelection({ choices, values, onChange, disabled }: { choices: PokerCardChoiceSpec[]; values: Record<string, string | number>; onChange: (values: Record<string, string | number>) => void; disabled: boolean }) {
  return <div className="space-y-4">{choices.map(choice => <RadioGroup key={choice.key} name={`card-${choice.key}`} variant="secondary" value={String(values[choice.key] ?? "")} onChange={value => onChange({ ...values, [choice.key]: value })} isDisabled={disabled}>
    <Label>{choice.label}</Label><div className="flex flex-wrap gap-3">{choice.options.map(option => <Radio key={option.value} value={option.value}><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><span className="wrap-anywhere">{option.label}</span></Radio.Content></Radio>)}</div>
  </RadioGroup>)}</div>
}
