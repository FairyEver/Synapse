/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppSwitchTransition } from "../app-switch-transition"

describe("AppSwitchTransition", () => {
  const roots: ReturnType<typeof createRoot>[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
    Reflect.deleteProperty(HTMLElement.prototype, "animate")
    document.body.innerHTML = ""
  })

  it("animates app changes without animating the initial dock app", async () => {
    const animationCalls: Array<[
      Keyframe[] | PropertyIndexedKeyframes,
      KeyframeAnimationOptions,
    ]> = []
    const cancelAnimation = vi.fn()
    const animateElement = vi.fn((
      keyframes: Keyframe[] | PropertyIndexedKeyframes,
      options?: number | KeyframeAnimationOptions,
    ) => {
      animationCalls.push([keyframes, options as KeyframeAnimationOptions])
      return { cancel: cancelAnimation } as unknown as Animation
    })
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animateElement,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AppSwitchTransition transitionKey="agent">
          <div>对话</div>
        </AppSwitchTransition>,
      )
      await Promise.resolve()
    })
    expect(animateElement).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <AppSwitchTransition transitionKey="drive">
          <div>云盘</div>
        </AppSwitchTransition>,
      )
      await Promise.resolve()
    })

    expect(animateElement).toHaveBeenCalledTimes(1)
    expect(animationCalls[0]?.[0]).toEqual([
      {
        opacity: 0.68,
        transform: "translate3d(0, 6px, 0) scale(0.992)",
      },
      {
        opacity: 1,
        transform: "translate3d(0, 0, 0) scale(1)",
      },
    ])
    expect(animationCalls[0]?.[1]).toMatchObject({
      duration: 200,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "backwards",
    })
  })

  it("can animate an app opened from the launcher on mount", async () => {
    const animateElement = vi.fn(() => ({
      cancel: vi.fn(),
    }) as unknown as Animation)
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animateElement,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AppSwitchTransition transitionKey="database" animateOnMount>
          <div>本地数据库</div>
        </AppSwitchTransition>,
      )
      await Promise.resolve()
    })

    expect(animateElement).toHaveBeenCalledTimes(1)
  })
})
