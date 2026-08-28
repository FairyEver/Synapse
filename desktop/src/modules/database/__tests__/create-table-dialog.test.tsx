/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CreateTableDialog } from "../components/create-table-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

afterEach(() => {
  document.body.replaceChildren()
})

describe("CreateTableDialog", () => {
  it("restores focus to the create trigger after Escape", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const triggerRef = { current: null as HTMLButtonElement | null }

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button ref={triggerRef}>新建表</button>
          <CreateTableDialog
            open={open}
            onOpenChange={setOpen}
            onSubmit={vi.fn()}
            restoreFocusRef={triggerRef}
          />
        </>
      )
    }

    await act(async () => root.render(<Harness />))
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve))
    })

    expect(document.activeElement).toBe(triggerRef.current)

    await act(async () => root.unmount())
  })

  it("focuses the table name after empty or invalid submissions", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<CreateTableDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
    })

    const nameInput = document.querySelector<HTMLInputElement>("#table-name")!
    const submitButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "创建")!

    submitButton.focus()
    await act(async () => {
      submitButton.click()
      await new Promise((resolve) => window.setTimeout(resolve))
    })
    expect(document.body.textContent).toContain("请输入表名")
    expect(document.activeElement).toBe(nameInput)

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      valueSetter?.call(nameInput, "36bad")
      nameInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    submitButton.focus()
    await act(async () => {
      submitButton.click()
      await new Promise((resolve) => window.setTimeout(resolve))
    })
    expect(document.body.textContent).toContain("表名须以英文字母开头")
    expect(document.activeElement).toBe(nameInput)

    await act(async () => root.unmount())
  })

  it("focuses the conflicting column after a duplicate column submission", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const setInputValue = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        valueSetter?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
    }

    await act(async () => {
      root.render(<CreateTableDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
    })

    await setInputValue(document.querySelector<HTMLInputElement>("#table-name")!, "r36_table")
    const addButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "+ 添加列")!
    await act(async () => {
      addButton.click()
      await new Promise((resolve) => window.setTimeout(resolve))
    })

    const columnInputs = document.body.querySelectorAll<HTMLInputElement>('input[placeholder="列名"]')
    await setInputValue(columnInputs[0], "label")
    await setInputValue(columnInputs[1], "label")

    const submitButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "创建")!
    submitButton.focus()
    await act(async () => {
      submitButton.click()
      await new Promise((resolve) => window.setTimeout(resolve))
    })

    expect(document.body.textContent).toContain('列名 "label" 重复')
    expect(document.activeElement).toBe(columnInputs[1])

    await act(async () => root.unmount())
  })

  it("focuses the column named by a rejected submission", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onSubmit = vi.fn().mockRejectedValue(
      new Error('Column "label" looks like a choice field. Replace with: ...'),
    )
    const setInputValue = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        valueSetter?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
    }

    await act(async () => {
      root.render(<CreateTableDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    })

    await setInputValue(document.querySelector<HTMLInputElement>("#table-name")!, "r36_table")
    const columnInput = document.body.querySelector<HTMLInputElement>('input[placeholder="列名"]')!
    await setInputValue(columnInput, "label")
    const submitButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "创建")!
    submitButton.focus()
    await act(async () => {
      submitButton.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(document.body.textContent).toContain('列 "label" 应使用单选或多选')
    expect(document.activeElement).toBe(columnInput)

    await act(async () => root.unmount())
  })
})
