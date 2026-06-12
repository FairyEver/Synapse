/**
 * @vitest-environment jsdom
 */
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
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

afterEach(() => {
  cleanup()
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

    expect(screen.getByText("执行配置")).toBeTruthy()
    expect(screen.getByLabelText("审批策略")).toBeTruthy()
    expect(screen.getByLabelText("沙箱")).toBeTruthy()
    expect(screen.getByLabelText("Goals")).toBeTruthy()
    expect(screen.getByLabelText("跳过 Git 仓库检查")).toBeTruthy()
    expect(screen.getByText("输入映射")).toBeTruthy()
    expect(screen.getByText("项目")).toBeTruthy()
    expect(screen.getByText("指令")).toBeTruthy()
    expect(screen.getByText("高级参数")).toBeTruthy()
    expect(screen.getByText("调试记录")).toBeTruthy()
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

    const textbox = screen.getByDisplayValue("Old")
    fireEvent.change(textbox, { target: { value: "New prompt" } })
    fireEvent.blur(textbox)

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

    fireEvent.click(screen.getByRole("checkbox", { name: "绕过审批和沙箱" }))

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

    fireEvent.click(screen.getByRole("option", { name: "禁用" }))

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

    fireEvent.click(screen.getByRole("button", { name: "添加配置覆盖" }))
    fireEvent.change(screen.getByLabelText("配置键 1"), { target: { value: "model_reasoning_effort" } })
    fireEvent.change(screen.getByLabelText("配置值 1"), { target: { value: "high" } })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      configOverrides: [{ key: "model_reasoning_effort", value: "high" }],
    }))

    fireEvent.click(screen.getByRole("button", { name: "删除配置覆盖 1" }))

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      configOverrides: [],
    }))
  })
})
