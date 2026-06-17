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

function getByText(text: string): HTMLElement {
  const match = allElements().find((element) => element.textContent?.trim() === text)
  if (!match) throw new Error(`Unable to find text: ${text}`)
  return match
}

function expectTextOrder(labels: string[]) {
  const positions = labels.map((label) => allElements().indexOf(getByText(label)))
  positions.forEach((position, index) => {
    expect(position, `${labels[index]} should be rendered`).toBeGreaterThanOrEqual(0)
    if (index > 0) {
      expect(position, `${labels[index]} should render after ${labels[index - 1]}`).toBeGreaterThan(positions[index - 1])
    }
  })
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

function elementName(element: HTMLElement): string {
  const ariaLabel = element.getAttribute("aria-label")
  if (ariaLabel) return ariaLabel
  return element.textContent?.trim() ?? ""
}

function elementRole(element: HTMLElement): string | null {
  const role = element.getAttribute("role")
  if (role) return role
  if (element.tagName === "BUTTON") return "button"
  if (element.tagName === "INPUT" && (element as HTMLInputElement).type === "checkbox") return "checkbox"
  return null
}

function getByRole(role: string, options: { name: string }): HTMLElement {
  const match = allElements().find((element) => (
    elementRole(element) === role && elementName(element) === options.name
  ))
  if (!match) throw new Error(`Unable to find role ${role} named ${options.name}`)
  return match
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
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
    expectTextOrder(["输入映射", "项目", "指令", "Claude Code 设置", "执行配置", "权限与访问", "调试记录"])
    expect(text).toContain("权限模式")
    expect(text).toContain("模型")
    expect(text).toContain("Max turns")
    expect(getByRole("button", { name: "查看权限模式说明" })).toBeTruthy()
    expect(getByRole("button", { name: "查看额外目录说明" })).toBeTruthy()
    expect(getByRole("button", { name: "查看保存调试文件说明" })).toBeTruthy()
  })

  it("opens field help dialogs", () => {
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

    click(getByRole("button", { name: "查看权限模式说明" }))

    expect(getByText("权限模式")).toBeTruthy()
    expect(getByText("控制 Claude Code 执行工具或修改文件前的授权方式。")).toBeTruthy()
    expect(getByText("影响范围：工具调用、文件修改、无人值守运行和安全边界。")).toBeTruthy()
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
