import { useLayoutEffect, useRef, type ReactNode } from "react"

const APP_SWITCH_DURATION_MS = 200
const APP_SWITCH_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

type AppSwitchTransitionProps = {
  readonly children: ReactNode
  readonly transitionKey: string
  readonly animateOnMount?: boolean
}

function AppSwitchTransition({
  animateOnMount = false,
  children,
  transitionKey,
}: AppSwitchTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)

  useLayoutEffect(() => {
    const shouldAnimate = mountedRef.current || animateOnMount
    mountedRef.current = true
    if (!shouldAnimate) return undefined
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined
    if (typeof containerRef.current?.animate !== "function") return undefined

    const animation = containerRef.current.animate([
      {
        opacity: 0.68,
        transform: "translate3d(0, 6px, 0) scale(0.992)",
      },
      {
        opacity: 1,
        transform: "translate3d(0, 0, 0) scale(1)",
      },
    ], {
      duration: APP_SWITCH_DURATION_MS,
      easing: APP_SWITCH_EASING,
      fill: "backwards",
    })

    return () => {
      animation.cancel()
    }
  }, [animateOnMount, transitionKey])

  return (
    <div ref={containerRef} data-app-switch-transition className="h-full min-h-0">
      {children}
    </div>
  )
}

export { AppSwitchTransition }
