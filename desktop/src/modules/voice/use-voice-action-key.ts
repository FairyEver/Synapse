import { useEffect } from "react"

import type { VoiceUiAction } from "./voice-input-presentation"

/**
 * 焦点落在这些节点上时 Enter 归它们自己：终端里点回 xterm 再回车是「执行这条命令」，
 * 底栏按钮上的回车是「点这个按钮」，两者都不该顺带把录音也收掉。xterm 的键盘输入
 * 挂在它内部那个 textarea 上，这条规则因此天然把终端排除在外。
 */
const INTERACTIVE_TARGET_SELECTOR =
  "input, textarea, select, button, [contenteditable]:not([contenteditable='false'])"

function ownsEnterKey(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_TARGET_SELECTOR) !== null
}

/**
 * 录音期间按 Enter 等价于点右槽那个键，说完最后一句不用再回鼠标上找对号。
 *
 * 右槽是什么由 `describeVoiceInput` 定，这里只做映射 —— Agent 对话和终端共用同一份
 * `action`，两个面的键位行为不会各自跑偏。置灰的两个状态不响应，理由和按钮置灰一样：
 * 提交空文本没有意义，解决不了的失败原地再试也不会变。
 */
export function useVoiceActionKey(input: {
  readonly action: VoiceUiAction
  readonly onConfirm: () => void
  readonly onRetry: () => void
}): void {
  const { action, onConfirm, onRetry } = input

  useEffect(() => {
    if (action !== "confirm" && action !== "retry") return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      // 按住不放不该连着确认，更不该连着重开录音。
      if (event.key !== "Enter" || event.repeat) return
      if (ownsEnterKey(event.target)) return
      event.preventDefault()
      if (action === "retry") onRetry()
      else onConfirm()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [action, onConfirm, onRetry])
}
