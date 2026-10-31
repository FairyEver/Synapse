import type { ComponentProps } from "react"
import { track, extractLabel } from "@/game-center/runtime/tracking"

export function PokerButton({ tone = "quiet", className = "", onClick, ...props }: ComponentProps<"button"> & { tone?: "quiet" | "primary" | "danger" }) {
  return <button {...props} type={props.type ?? "button"} className={`poker-button ${className}`} data-tone={tone} onClick={event => {
    track({ component: "button", name: extractLabel(event.currentTarget) ?? "poker", action: "click" })
    onClick?.(event)
  }} />
}
