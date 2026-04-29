import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

interface RenderResult {
  readonly container: HTMLDivElement
  readonly unmount: () => void
}

export async function render(element: React.ReactElement): Promise<RenderResult> {
  const container = document.createElement("div")
  document.body.append(container)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(container)
    root.render(element)
  })

  return {
    container,
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
  }
}

export function changeInput(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

export async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < 1000) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw lastError
}
