import { Fragment } from "react"

function DiamondIcon() {
  return <>
    <span className="inline-block size-[1em] align-text-bottom" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-full">
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
    <span className="sr-only">钻石</span>
  </>
}

/** Keep the accessible unit, including messages returned by older servers. */
export function PokerDiamondText({ text }: { text: string }) {
  return <>{text.replaceAll("金币", "钻石").split("钻石").map((part, index) => <Fragment key={index}>
    {index > 0 && <DiamondIcon />}{part}
  </Fragment>)}</>
}
