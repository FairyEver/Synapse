import { useEffect, useRef, type RefObject } from "react"

/**
 * 录音时 Enter 是提交意图，在捕获阶段拦截，避免 xterm 先执行旧输入。
 * 收尾后仍吃掉同一次按住产生的重复事件，直到松键才恢复普通输入。
 */
export function useVoiceActionKey(input: {
  readonly active: boolean
  readonly pending: boolean
  readonly scopeRef: RefObject<HTMLElement | null>
  readonly onSubmit: () => void
}): void {
  const latest = useRef(input)
  latest.current = input
  const held = useRef(false)

  useEffect(() => {
    const stop = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      const { active, pending, scopeRef, onSubmit } = latest.current
      if (!active && !held.current) return
      const target = event.target
      // 按钮卸载后焦点会回到 body；其它输入区和弹窗的回车不属于这次语音。
      if (target instanceof Node && target !== document && target !== document.body
        && !scopeRef.current?.contains(target)) return
      stop(event)
      if (event.repeat || held.current) return
      held.current = true
      if (!pending && active) onSubmit()
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !held.current) return
      held.current = false
      stop(event)
    }
    const release = () => { held.current = false }
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    window.addEventListener("blur", release)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
      window.removeEventListener("blur", release)
    }
  }, [])
}
