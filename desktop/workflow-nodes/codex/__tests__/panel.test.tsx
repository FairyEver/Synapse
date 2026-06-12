/**
 * @vitest-environment jsdom
 */
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CodexNodePanel } from "../panel"
import { defaultCodexNodeConfig } from "../schema"

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
  extractLabel: vi.fn(() => "control"),
}))

vi.mock("../../prompt-editor", () => ({
  PromptEditor: ({
    value,
    onChange,
    onBlur,
    placeholder,
  }: {
    value: string
    onChange?: (value: string) => void
    onBlur?: () => void
    placeholder?: string
  }) => (
    <textarea
      value={value}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      onBlur={onBlur}
      placeholder={placeholder}
    />
  ),
}))

vi.mock("@/components/ui/select", () => {
  const ReactModule = React

  function collectLabels(node: React.ReactNode, labels: Record<string, React.ReactNode> = {}) {
    ReactModule.Children.forEach(node, (child) => {
      if (!ReactModule.isValidElement(child)) return
      if (typeof child.props.value === "string" && child.props.children !== undefined) {
        labels[child.props.value] = child.props.children
      }
      if (child.props.children) {
        collectLabels(child.props.children, labels)
      }
    })
    return labels
  }

  const SelectContext = ReactModule.createContext<{
    value?: string
    onValueChange?: (value: string) => void
    labels: Record<string, React.ReactNode>
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
      <SelectContext.Provider value={{ value, onValueChange, labels: collectLabels(children) }}>
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
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const context = ReactModule.useContext(SelectContext)
      return <span>{context?.value ? context.labels[context.value] ?? context.value : placeholder}</span>
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

  return {
    rerender(nextElement: React.ReactElement) {
      act(() => {
        root?.render(nextElement)
      })
    },
  }
}

function allElements(): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>("*") ?? [])
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
  const nestedControl = labelElement?.querySelector<HTMLElement>("button,input,textarea,[role]")
  if (nestedControl) return nestedControl

  throw new Error(`Unable to find label: ${label}`)
}

function getByRole(role: string, options: { name: string }): HTMLElement {
  const match = allElements().find((element) => (
    elementRole(element) === role && elementName(element) === options.name
  ))
  if (!match) throw new Error(`Unable to find role ${role} named ${options.name}`)
  return match
}

function getByDisplayValue(value: string): HTMLInputElement | HTMLTextAreaElement {
  const match = allElements().find((element) => (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.value === value
  ))
  if (!match || !(match instanceof HTMLInputElement || match instanceof HTMLTextAreaElement)) {
    throw new Error(`Unable to find display value: ${value}`)
  }
  return match
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }))
    element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }))
  })
}

function blur(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, cancelable: true }))
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = undefined
  container = undefined
  vi.clearAllMocks()
})

describe("CodexNodePanel", () => {
  it("renders unattended default controls", () => {
    render(
      <CodexNodePanel
        config={{ ...defaultCodexNodeConfig, prompt: "Run" }}
        onChange={vi.fn()}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    expectTextOrder(["输入映射", "项目", "指令", "执行配置", "高级参数", "调试记录"])
    expect(getByLabelText("审批策略")).toBeTruthy()
    expect(getByLabelText("沙箱")).toBeTruthy()
    expect(getByLabelText("Goals")).toBeTruthy()
    expect(getByLabelText("跳过 Git 仓库检查")).toBeTruthy()
    expect(getByRole("button", { name: "审批策略" }).textContent).toContain("never")
    expect(getByRole("button", { name: "沙箱" }).textContent).toContain("workspace-write")
    expect(getByRole("button", { name: "Goals" }).textContent).toContain("启用")
    expect(getByRole("checkbox", { name: "跳过 Git 仓库检查" }).getAttribute("aria-checked")).toBe("true")
    expect(getByRole("checkbox", { name: "保存调试文件" }).getAttribute("aria-checked")).toBe("true")
  })

  it("commits prompt changes on blur", () => {
    const onChange = vi.fn()

    render(
      <CodexNodePanel
        config={{ ...defaultCodexNodeConfig, prompt: "Old" }}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    const textbox = getByDisplayValue("Old")
    change(textbox, "New prompt")
    blur(textbox)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: "New prompt" }))
  })

  it("toggles bypass approvals and sandbox", () => {
    const onChange = vi.fn()

    render(
      <CodexNodePanel
        config={defaultCodexNodeConfig}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    click(getByRole("checkbox", { name: "绕过审批和沙箱" }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      bypassApprovalsAndSandbox: true,
    }))
  })

  it("changes goals feature state", () => {
    const onChange = vi.fn()

    render(
      <CodexNodePanel
        config={defaultCodexNodeConfig}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    click(getByRole("option", { name: "禁用" }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      features: { goals: "disabled" },
    }))
  })

  it("adds and removes config overrides", () => {
    const onChange = vi.fn()

    render(
      <CodexNodePanel
        config={defaultCodexNodeConfig}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    click(getByRole("button", { name: "添加配置覆盖" }))
    change(getByLabelText("配置键 1") as HTMLInputElement, "model_reasoning_effort")
    change(getByLabelText("配置值 1") as HTMLInputElement, "high")

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      configOverrides: [{ key: "model_reasoning_effort", value: "high" }],
    }))

    click(getByRole("button", { name: "删除配置覆盖 1" }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      configOverrides: [],
    }))
  })

  it("syncs external config into local panel state before later edits", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <CodexNodePanel
        config={{
          ...defaultCodexNodeConfig,
          prompt: "Old prompt",
          additionalWritableDirs: ["/tmp/old-dir"],
          configOverrides: [{ key: "approval_mode", value: "never" }],
        }}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    rerender(
      <CodexNodePanel
        config={{
          ...defaultCodexNodeConfig,
          prompt: "Updated prompt",
          additionalWritableDirs: ["/tmp/new-dir"],
          configOverrides: [{ key: "sandbox_workspace_write.network_access", value: "true" }],
        }}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )

    click(getByRole("checkbox", { name: "启用搜索" }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: "Updated prompt",
      additionalWritableDirs: ["/tmp/new-dir"],
      configOverrides: [{ key: "sandbox_workspace_write.network_access", value: "true" }],
      enableSearch: true,
    }))
  })
})
