/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseQuickInputItem } from "../../../../src/types/quick-input"
import { DEFAULT_QUICK_INPUT_CONTENTS } from "../../../quick-input/shared/defaults"
import { TerminalQuickInputMenu, quickInputBody, quickInputLabel } from "../terminal-quick-input-menu"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BUILT_IN_ITEMS: readonly SynapseQuickInputItem[] = DEFAULT_QUICK_INPUT_CONTENTS.map((entry, index) => ({
  id: entry.id,
  schemaVersion: 1,
  content: entry.content,
  sortOrder: index,
  createdAt: "2026-09-21T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
}))

function quickInputItem(id: string, content: string): SynapseQuickInputItem {
  return {
    id,
    schemaVersion: 1,
    content,
    sortOrder: 0,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  }
}

let root: Root | null = null

beforeEach(() => {
  root = null
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
    root = null
  }
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function renderMenu(items: readonly SynapseQuickInputItem[], onPick: (content: string) => void, disabled?: boolean) {
  const container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  act(() => {
    root?.render(<TerminalQuickInputMenu items={items} onPick={onPick} disabled={disabled} />)
  })
}

function triggerButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("button[aria-label='快捷输入']")
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='popover-content']")
}

function rowButton(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label='填入快捷输入：${label}']`)
}

function eyeButton(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label='看全文：${label}']`)
}

function openPanel() {
  act(() => {
    triggerButton()?.click()
  })
}

function previewText(): string | null {
  return panel()?.querySelector("p")?.textContent ?? null
}

describe("quickInputLabel / quickInputBody", () => {
  it("跳过开头连续的空行，取第一个非空行做标签", () => {
    expect(quickInputLabel("\n\n   \n第一行\n第二行")).toBe("第一行")
    expect(quickInputBody("\n\n   \n第一行\n第二行")).toBe("第二行")
  })

  it("只有一行时没有正文", () => {
    expect(quickInputLabel("就一行")).toBe("就一行")
    expect(quickInputBody("就一行")).toBe("")
  })

  it("去掉行首行尾的空白", () => {
    expect(quickInputLabel("   帮我捋一下   \n   把信息整理一下。  ")).toBe("帮我捋一下")
    expect(quickInputBody("   帮我捋一下   \n   把信息整理一下。  ")).toBe("把信息整理一下。")
  })

  it("正文里的多余空行折成一个空格", () => {
    expect(quickInputLabel("标签\n\n  第一段  \n\n\n第二段\n")).toBe("标签")
    expect(quickInputBody("标签\n\n  第一段  \n\n\n第二段\n")).toBe("第一段 第二段")
  })

  it("超长内容截断加省略号", () => {
    const label = quickInputLabel(`${"标".repeat(40)}\n正文`)
    expect(label).toBe(`${"标".repeat(24)}…`)
    expect(quickInputBody(`标签\n${"文".repeat(100)}`)).toBe(`${"文".repeat(60)}…`)
  })

  it("整条都是空白时标签与正文都为空", () => {
    expect(quickInputLabel("\n  \n\t\n")).toBe("")
    expect(quickInputBody("\n  \n\t\n")).toBe("")
  })
})

describe("TerminalQuickInputMenu", () => {
  it("列表为空时整组件不渲染", () => {
    renderMenu([], vi.fn())
    expect(document.body.textContent).toBe("")
    expect(triggerButton()).toBeNull()
  })

  it("六条内置句子逐条渲染出正确的标签与正文", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn())
    openPanel()

    // 期望值按 `quick-input/shared/defaults.ts` 原文手写，不跟着实现算，否则函数算错也照样绿。
    const expected = [
      ["帮我捋一下", "把这里的信息重新整理一下，重点放在结论、分歧和下一步。"],
      ["给个结论", "先说结论，再用几条要点说明理由。"],
      ["哪里有问题", "帮我挑一下毛病，重点看不清楚、不完整、前后打架的地方。"],
      ["改得像正式文档", "保持原意，把表达改得更清楚、更克制、更适合放进文档。"],
      ["整理成待办", "拆成可执行的待办事项，按优先级排一下。"],
      ["存到桌面", "整理成一份 Markdown 文件，保存到我的桌面。"],
    ]
    expect(expected.map(([label]) => label)).toEqual(DEFAULT_QUICK_INPUT_CONTENTS.map((entry) => entry.content.split("\n")[0]))

    for (const [expectedLabel, expectedBody] of expected) {
      const row = rowButton(expectedLabel)
      expect(row, `缺少行：${expectedLabel}`).not.toBeNull()
      const spans = row?.querySelectorAll("span")
      expect(spans?.[0]?.textContent).toBe(expectedLabel)
      expect(spans?.[1]?.textContent).toBe(expectedBody)
      expect(eyeButton(expectedLabel)).not.toBeNull()
    }
  })

  it("没有第二行时不渲染正文那一行", () => {
    renderMenu([quickInputItem("only-one-line", "就一行")], vi.fn())
    openPanel()

    const spans = rowButton("就一行")?.querySelectorAll("span")
    expect(spans).toHaveLength(1)
  })

  it("点一行把完整原文（含换行）交给 onPick，并关掉面板", () => {
    const onPick = vi.fn()
    renderMenu(BUILT_IN_ITEMS, onPick)
    openPanel()

    act(() => {
      rowButton("帮我捋一下")?.click()
    })

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0]).toBe(DEFAULT_QUICK_INPUT_CONTENTS[0].content)
    expect(onPick.mock.calls[0][0]).toContain("\n")
    expect(panel()).toBeNull()
    expect(eyeButton("帮我捋一下")).toBeNull()
  })

  it("点眼睛展开全文，点 X 收起", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn())
    openPanel()

    expect(previewText()).toBeNull()
    act(() => {
      eyeButton("改得像正式文档")?.click()
    })
    expect(previewText()).toBe(DEFAULT_QUICK_INPUT_CONTENTS[3].content)
    expect(previewText()).toContain("\n")

    act(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label='收起全文']")?.click()
    })
    expect(previewText()).toBeNull()
    expect(document.querySelector("button[aria-label='收起全文']")).toBeNull()
  })

  it("点眼睛不触发 onPick", () => {
    const onPick = vi.fn()
    renderMenu(BUILT_IN_ITEMS, onPick)
    openPanel()

    act(() => {
      eyeButton("给个结论")?.click()
    })

    expect(onPick).not.toHaveBeenCalled()
  })

  it("眼睛按钮带 aria-label、是行主体的兄弟按钮且不在里面", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn())
    openPanel()

    const row = rowButton("整理成待办")
    const eye = eyeButton("整理成待办")
    expect(eye).not.toBeNull()
    expect(eye?.getAttribute("aria-label")).toBe("看全文：整理成待办")
    expect(eye?.tagName).toBe("BUTTON")
    expect(eye?.disabled).toBe(false)
    expect(eye?.getAttribute("tabindex")).toBeNull()
    expect(row?.querySelector("button")).toBeNull()
    expect(row?.parentElement).toBe(eye?.parentElement)
  })

  it("面板自己带 .dark，不靠终端区的主题继承", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn())
    openPanel()

    expect(panel()?.classList.contains("dark")).toBe(true)
  })

  it("预览文字可选中复制，且保留换行", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn())
    openPanel()
    act(() => {
      eyeButton("存到桌面")?.click()
    })

    const text = panel()?.querySelector("p")
    expect(text?.className).toContain("select-text")
    expect(text?.className).toContain("whitespace-pre-wrap")
    expect(text?.textContent).toBe(DEFAULT_QUICK_INPUT_CONTENTS[5].content)
  })

  it("换一条看全文会替换预览内容", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn())
    openPanel()
    act(() => {
      eyeButton("给个结论")?.click()
    })
    expect(previewText()).toBe(DEFAULT_QUICK_INPUT_CONTENTS[1].content)

    act(() => {
      eyeButton("存到桌面")?.click()
    })
    expect(previewText()).toBe(DEFAULT_QUICK_INPUT_CONTENTS[5].content)
  })

  it("打开预览后点某一行，面板与预览一起关掉", () => {
    const onPick = vi.fn()
    renderMenu(BUILT_IN_ITEMS, onPick)
    openPanel()
    act(() => {
      eyeButton("给个结论")?.click()
    })
    expect(previewText()).not.toBeNull()

    act(() => {
      rowButton("给个结论")?.click()
    })

    expect(onPick.mock.calls[0][0]).toBe(DEFAULT_QUICK_INPUT_CONTENTS[1].content)
    expect(panel()).toBeNull()
  })

  it("面板开着时会话变成非 running，面板与预览一起收起", () => {
    const onPick = vi.fn()
    renderMenu(BUILT_IN_ITEMS, onPick, false)
    openPanel()
    act(() => {
      eyeButton("给个结论")?.click()
    })
    expect(panel()).not.toBeNull()
    expect(previewText()).toBe(DEFAULT_QUICK_INPUT_CONTENTS[1].content)

    act(() => {
      root?.render(<TerminalQuickInputMenu items={BUILT_IN_ITEMS} onPick={onPick} disabled />)
    })

    expect(panel()).toBeNull()
    expect(previewText()).toBeNull()
    expect(document.querySelector("button[aria-label='收起全文']")).toBeNull()
  })

  it("disabled 时入口存在但不可用", () => {
    renderMenu(BUILT_IN_ITEMS, vi.fn(), true)

    expect(triggerButton()).not.toBeNull()
    expect(triggerButton()?.disabled).toBe(true)
  })
})
