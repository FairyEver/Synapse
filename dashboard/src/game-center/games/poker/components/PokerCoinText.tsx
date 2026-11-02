import { Fragment } from "react"

function GoldCoinIcon() {
  return <>
    <span className="inline-block size-[1em] align-text-bottom" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-full">
        <circle cx="12" cy="13" r="10" fill="var(--warning-foreground)" fillOpacity="0.35" />
        <circle cx="12" cy="11" r="10" fill="var(--warning)" />
        <circle cx="12" cy="11" r="9.5" fill="none" stroke="var(--warning-foreground)" strokeOpacity="0.3" />
        <circle cx="12" cy="11" r="7.5" fill="none" stroke="var(--warning-foreground)" strokeOpacity="0.25" />
        <path d="M5.2 8A7.5 7.5 0 0 1 16 4.7" fill="none" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.75" />
        <path d="m12 6 1.55 3.14 3.47.5-2.51 2.45.59 3.45L12 13.91l-3.1 1.63.59-3.45-2.51-2.45 3.47-.5Z" fill="var(--warning-foreground)" fillOpacity="0.6" />
      </svg>
    </span>
    <span className="sr-only">金币</span>
  </>
}

/** Preserve the readable currency unit while presenting a coin at the surrounding text size. */
export function PokerCoinText({ text }: { text: string }) {
  return <>{text.split("金币").map((part, index) => <Fragment key={index}>
    {index > 0 && <GoldCoinIcon />}{part}
  </Fragment>)}</>
}
