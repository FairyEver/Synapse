/**
 * @vitest-environment jsdom
 */
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CommandConfigForm } from "../command/config.renderer"
import type { CommandActionConfig } from "../command/schema"
import { ScriptConfigForm } from "../script/config.renderer"
import type { ScriptActionConfig } from "../script/schema"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

function changeTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  if (!setter) throw new Error("Textarea value setter not found")
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount()
    })
  }
  document.body.innerHTML = ""
})

describe("action config environment textareas", () => {
  it("keeps command env intermediate input visible until it parses", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()
    const value: CommandActionConfig = {
      command: "echo ok",
      shell: "posix",
      env: undefined,
    }

    await act(async () => {
      root.render(React.createElement(CommandConfigForm, { value, onChange }))
    })

    const textarea = container.querySelector("#task-action-command-env")
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)

    await act(async () => {
      changeTextareaValue(textarea as HTMLTextAreaElement, "TOKEN")
    })

    expect((textarea as HTMLTextAreaElement).value).toBe("TOKEN")
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      changeTextareaValue(textarea as HTMLTextAreaElement, "TOKEN=value")
    })

    expect((textarea as HTMLTextAreaElement).value).toBe("TOKEN=value")
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      env: { TOKEN: "value" },
    }))
  })

  it("keeps script env intermediate input visible until it parses", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()
    const value: ScriptActionConfig = {
      script: "echo ok",
      shell: "posix",
      env: undefined,
    }

    await act(async () => {
      root.render(React.createElement(ScriptConfigForm, { value, onChange }))
    })

    const textarea = container.querySelector("#task-action-script-env")
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)

    await act(async () => {
      changeTextareaValue(textarea as HTMLTextAreaElement, "TOKEN")
    })

    expect((textarea as HTMLTextAreaElement).value).toBe("TOKEN")
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      changeTextareaValue(textarea as HTMLTextAreaElement, "TOKEN=value")
    })

    expect((textarea as HTMLTextAreaElement).value).toBe("TOKEN=value")
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      env: { TOKEN: "value" },
    }))
  })
})
