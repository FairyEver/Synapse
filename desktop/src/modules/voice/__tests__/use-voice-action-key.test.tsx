/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useVoiceActionKey } from "../use-voice-action-key"
import type { VoiceUiAction } from "../voice-input-presentation"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
})

function renderProbe(action: VoiceUiAction) {
  const onConfirm = vi.fn()
  const onRetry = vi.fn()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const Probe = () => {
    useVoiceActionKey({ action, onConfirm, onRetry })
    return null
  }
  act(() => {
    root.render(<Probe />)
  })
  return { onConfirm, onRetry }
}

function pressKey(target: EventTarget, key = "Enter", init?: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }))
  })
}

const pressEnter = (target: EventTarget, init?: KeyboardEventInit) => pressKey(target, "Enter", init)

describe("useVoiceActionKey", () => {
  it("录音出字后按回车等价于点确定键", () => {
    const { onConfirm, onRetry } = renderProbe("confirm")

    pressEnter(window)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  /**
   * 右槽是重试时（断网 / 没听到声音，且一个字都没出），回车跟着点重试 —— 键位和
   * 它替代的那个键始终是同一件事。
   */
  it("右槽是重试时按回车走重试，不是确定", () => {
    const { onConfirm, onRetry } = renderProbe("retry")

    pressEnter(window)

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  /**
   * 这三个状态右槽点不动，回车同样不该有反应：提交空文本没有意义，解决不了的
   * 失败（权限、服务不可用）原地再试也不会变。
   */
  it.each<VoiceUiAction>(["none", "confirm-disabled", "retry-disabled"])(
    "右槽是 %s 时按回车什么都不做",
    (action) => {
      const { onConfirm, onRetry } = renderProbe(action)

      pressEnter(window)

      expect(onConfirm).not.toHaveBeenCalled()
      expect(onRetry).not.toHaveBeenCalled()
    },
  )

  /**
   * 终端里点回 xterm 再按回车是「执行这条命令」，底栏按钮上的回车是「点这个按钮」——
   * 两种都不该顺带把录音也收掉。xterm 的键盘输入挂在它内部那个 textarea 上。
   */
  it("回车落在输入框或按钮上时不归录音", () => {
    const { onConfirm } = renderProbe("confirm")
    const textarea = document.createElement("textarea")
    const button = document.createElement("button")
    document.body.append(textarea, button)

    pressEnter(textarea)
    pressEnter(button)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("别的键不响应", () => {
    const { onConfirm } = renderProbe("confirm")

    pressKey(window, "Escape")

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("按住不放只算一次", () => {
    const { onConfirm } = renderProbe("confirm")

    pressEnter(window, { repeat: true })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  /** 录音结束后监听必须撤掉，否则回车会在别处继续冒出一次确认。 */
  it("退出录音后回车不再响应", () => {
    const onConfirm = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const Probe = ({ action }: { readonly action: VoiceUiAction }) => {
      useVoiceActionKey({ action, onConfirm, onRetry: vi.fn() })
      return null
    }
    act(() => {
      root.render(<Probe action="confirm" />)
    })
    act(() => {
      root.render(<Probe action="none" />)
    })
    pressEnter(window)
    expect(onConfirm).not.toHaveBeenCalled()

    act(() => {
      root.unmount()
    })

    pressEnter(window)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
