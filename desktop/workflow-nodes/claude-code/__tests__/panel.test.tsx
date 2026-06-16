/**
 * @vitest-environment jsdom
 */
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeCodeNodePanel } from "../panel"
import { defaultClaudeCodeNodeConfig } from "../schema"

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
  extractLabel: vi.fn(() => "control"),
  mergeRefs: (...refs: Array<React.Ref<unknown> | undefined>) => (value: unknown) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(value)
      } else if (ref && "current" in ref) {
        ;(ref as React.MutableRefObject<unknown>).current = value
      }
    })
  },
}))

vi.mock("../../prompt-editor", () => ({
  PromptEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange?: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock("@/components/ui/select", () => {
  const ReactModule = React

  const SelectContext = ReactModule.createContext<{
    value?: string
    onValueChange?: (value: string) => void
  } | null>(null)

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      children: React.ReactNode
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({
      children,
      className,
      id,
      "aria-label": ariaLabel,
    }: {
      children: React.ReactNode
      className?: string
      id?: string
      "aria-label"?: string
    }) => (
      <button type="button" className={className} id={id} aria-label={ariaLabel}>
        {children}
      </button>
    ),
    SelectValue: () => {
      const context = ReactModule.useContext(SelectContext)
      return <span>{context?.value}</span>
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      children,
      value,
      className,
    }: {
      children: React.ReactNode
      value: string
      className?: string
    }) => {
      const context = ReactModule.useContext(SelectContext)
      return (
        <button
          type="button"
          role="option"
          className={className}
          aria-selected={context?.value === value}
          onClick={() => context?.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
  }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | undefined
let root: Root | undefined

function render(element: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(element)
  })
}

function allElements(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>("*"))
}

function getByLabelText(label: string): HTMLElement {
  const byAria = allElements().find((element) => element.getAttribute("aria-label") === label)
  if (byAria) return byAria

  const labelElement = allElements().find((element) => (
    element.tagName === "LABEL" && element.textContent?.trim() === label
  ))
  const controlId = labelElement?.getAttribute("for")
  if (controlId) {
    const control = document.getElementById(controlId)
    if (control instanceof HTMLElement) return control
  }

  throw new Error(`Unable to find label: ${label}`)
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  if (!setter) {
    throw new Error("Unable to set input value")
  }

  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = undefined
  root = undefined
})

describe("ClaudeCodeNodePanel", () => {
  it("renders Claude Code execution controls", () => {
    render(
      <ClaudeCodeNodePanel
        config={{ ...defaultClaudeCodeNodeConfig, prompt: "Run tests" }}
        onChange={vi.fn()}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
        validationItems={[]}
      />,
    )

    const text = document.body.textContent ?? ""
    expect(text).toContain("执行配置")
    expect(text).toContain("Permission mode")
    expect(text).toContain("模型")
    expect(text).toContain("Max turns")
    expect(text).toContain("Claude Code 配置")
    expect(text).toContain("权限规则")
    expect(text).toContain("调试记录")
  })

  it("updates model input", () => {
    const onChange = vi.fn()
    render(
      <ClaudeCodeNodePanel
        config={{ ...defaultClaudeCodeNodeConfig, prompt: "Run tests" }}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
        validationItems={[]}
      />,
    )

    act(() => {
      const model = getByLabelText("模型") as HTMLInputElement
      changeInput(model, "sonnet")
    })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: "sonnet" }))
  })

  it("keeps at least one setting source selected", () => {
    const onChange = vi.fn()
    render(
      <ClaudeCodeNodePanel
        config={{ ...defaultClaudeCodeNodeConfig, prompt: "Run tests", settingSources: ["user"] }}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
        validationItems={[]}
      />,
    )

    act(() => {
      const userSource = getByLabelText("user") as HTMLButtonElement
      userSource.click()
    })

    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ settingSources: [] }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
