import type { PokerChipValue } from "@synapse/shared/game-contracts"
export function PokerChip({value}: {value:PokerChipValue}) {
  return <span className="poker-chip" data-chip-value={value} aria-hidden="true"><svg viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="31" className="poker-chip-disc" />
    {Array.from({length:8},(_,i)=><path key={i} d="M28 3H36L35 12H29Z" className="poker-chip-edge" transform={`rotate(${i*45} 32 32)`} />)}
    <circle cx="32" cy="32" r="23" className="poker-chip-ring" /><circle cx="32" cy="32" r="20" className="poker-chip-dots" />
    <text x="32" y="33" textAnchor="middle" dominantBaseline="middle">{value}</text>
  </svg></span>
}
