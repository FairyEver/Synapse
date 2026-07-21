/**
 * @vitest-environment jsdom
 */
import React, { forwardRef } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PromptEditor } from "../prompt-editor"

vi.mock("@codemirror/autocomplete", () => ({
  autocompletion: vi.fn(() => ({})),
  startCompletion: vi.fn(),
}))

vi.mock("@uiw/react-codemirror", () => ({
  default: forwardRef(function CodeMirrorMock(
    props: { value: string; placeholder?: string },
    _ref: React.ForwardedRef<unknown>,
  ) {
    return <textarea value={props.value} placeholder={props.placeholder} readOnly />
  }),
  EditorView: {
    lineWrapping: {},
    domEventHandlers: vi.fn(() => ({})),
    updateListener: { of: vi.fn(() => ({})) },
  },
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | undefined
let root: Root | undefined

function renderPromptEditor(enableSkillShortcuts?: boolean) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root?.render(
      <PromptEditor
        value=""
        onChange={vi.fn()}
        onBlur={vi.fn()}
        variables={[]}
        enableSkillShortcuts={enableSkillShortcuts}
      />,
    )
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = undefined
  root = undefined
})

describe("PromptEditor", () => {
  it("keeps Skill shortcuts enabled by default", () => {
    renderPromptEditor()

    expect(container?.textContent).toContain("@ 变量")
    expect(container?.textContent).toContain("/ Skill")
  })

  it("can expose variables without exposing Skill shortcuts", () => {
    renderPromptEditor(false)

    expect(container?.textContent).toContain("@ 变量")
    expect(container?.textContent).not.toContain("/ Skill")
  })
})
