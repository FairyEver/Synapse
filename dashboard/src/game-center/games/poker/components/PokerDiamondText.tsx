import { Fragment } from "react"
import type { PokerRollOffer } from "@synapse/shared/game-contracts"
import { amount } from "../lib/view"

function DiamondIcon() {
  return <span className="inline-flex size-[1em] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 1 24 24" className="block size-full">
        <path d="m6 3-5 6 11 14L23 9l-5-6Z" fill="var(--accent)" />
        <path d="M6 3h3L7 9H1Z" fill="var(--accent-foreground)" fillOpacity="0.5" />
        <path d="M9 3h6l2 6H7Z" fill="var(--accent-foreground)" fillOpacity="0.8" />
        <path d="M15 3h3l5 6h-6Z" fill="var(--foreground)" fillOpacity="0.12" />
        <path d="M1 9h6l5 14Z" fill="var(--accent-foreground)" fillOpacity="0.4" />
        <path d="M7 9h10l-5 14Z" fill="var(--accent-foreground)" fillOpacity="0.15" />
        <path d="M17 9h6L12 23Z" fill="var(--foreground)" fillOpacity="0.2" />
        <path d="m6 3-5 6 11 14L23 9l-5-6ZM1 9h22M9 3 7 9l5 14 5-14-2-6" fill="none" stroke="var(--accent)" strokeWidth="0.65" strokeLinejoin="round" />
      </svg>
    </span>
}

/** Keep the accessible unit, including messages returned by older servers. */
export function PokerDiamondText({ text }: { text: string }) {
  return <span className="inline-flex flex-wrap items-center gap-1 align-middle">{text.replaceAll("金币", "钻石").split("钻石").map((part, index) => <Fragment key={index}>
    {index > 0 && <><DiamondIcon /><span className="sr-only">钻石</span></>}{part}
  </Fragment>)}</span>
}

export function PokerDiamondAmount({ value }: { value: number }) {
  return <span className="inline-flex items-center gap-1 tabular-nums">
    <DiamondIcon /><span className="sr-only">钻石 </span><span>{amount(value)}</span>
  </span>
}

export function PokerRollCost({ offer, unit }: { offer: PokerRollOffer | undefined; unit: string }) {
  return <span className="inline-flex flex-wrap items-center justify-center gap-2 tabular-nums">
    {offer?.coinCost != null && <>
      <span role="img" aria-label={`${offer.coinCost} 钻石`} className="inline-flex items-center gap-0.5">
        {Array.from({ length: offer.coinCost }, (_, index) => <DiamondIcon key={index} />)}
      </span>
      <span>+</span>
    </>}
    <span>{amount(offer?.fee ?? 0)}{unit}</span>
  </span>
}
