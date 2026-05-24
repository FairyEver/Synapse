/**
 * @vitest-environment jsdom
 */
import React, { createContext, useContext, type ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@xyflow/react", () => ({
  Handle: ({ type }: { readonly type: string }) => <span data-handle={type} />,
  Position: { Left: "left", Right: "right" },
}))

vi.mock("../node-context-menu", () => ({
  NodeContextMenu: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
    <div data-slot="scroll-area" className={className}>{children}</div>
  ),
}))

vi.mock("@/components/ui/select", () => {
  const SelectContext = createContext<{ readonly value?: string; readonly onValueChange?: (value: string) => void }>({})
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      readonly value?: string
      readonly onValueChange?: (value: string) => void
      readonly children: ReactNode
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div data-slot="select" data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: { readonly children: ReactNode }) => <div data-slot="select-content">{children}</div>,
    SelectGroup: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { readonly value: string; readonly children: ReactNode }) => {
      const context = useContext(SelectContext)
      return (
        <button type="button" data-value={value} onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children, className }: { readonly children: ReactNode; readonly className?: string }) => (
      <button type="button" data-slot="select-trigger" className={className}>{children}</button>
    ),
    SelectValue: ({ placeholder }: { readonly placeholder?: string }) => {
      const context = useContext(SelectContext)
      return <span>{context.value ?? placeholder}</span>
    },
  }
})

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    id,
    "aria-label": ariaLabel,
  }: {
    readonly checked?: boolean
    readonly onCheckedChange?: (checked: boolean) => void
    readonly id?: string
    readonly "aria-label"?: string
  }) => (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-label={ariaLabel}
      aria-checked={checked ? "true" : "false"}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock("../../../../workflow-nodes/provider-lookup-context", () => ({
  useProviderLookup: () => ({
    getProviderName: () => undefined,
    getModelName: () => undefined,
    isProviderAvailable: () => true,
  }),
}))

vi.mock("../hooks/use-upstream-nodes", () => ({
  useUpstreamNodes: () => [],
}))

vi.mock("../components/params-editor-dialog", () => ({
  ParamsEditorDialog: () => null,
}))

vi.mock("@/components/provider-model-select-dialog", () => ({
  ProviderModelSelectDialog: () => null,
}))

import "../../../../../workflow-nodes/register.renderer"
import { NodePalette } from "../node-palette"
import { NodeConfigPanel } from "../node-config-panel"
import { nodeTypes } from "../node-wrappers"
import type { WorkflowDefinition } from "@/types/workflow"

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
  vi.clearAllMocks()
})

describe("file conversion workflow node UI", () => {
  it("lists file conversion in the node palette", async () => {
    const container = render(<NodePalette />)

    expect(container.textContent).toContain("文件转换")
  })

  it("edits file conversion config and shows input validation", async () => {
    const onConfigChange = vi.fn()
    const definition = workflowWithFileConversionNode({
      inputPath: "",
      outputMode: "result",
      outputPath: "",
      outputDirectory: "",
      ocr: { enabled: false, languages: [], maxPages: undefined },
    })

    const container = render(
      <NodeConfigPanel
        nodeId="convert-1"
        definition={definition}
        projects={[]}
        onConfigChange={onConfigChange}
        onNameChange={() => undefined}
        validationItems={[{
          id: "convert-1:inputPath",
          summary: "输入路径不能为空。",
          location: "文件转换",
          nodeId: "convert-1",
          fieldKey: "inputPath",
          type: "invalid_config",
        }]}
      />,
    )

    expect(container.textContent).toContain("输入路径不能为空。")
    expect(container.textContent).toContain("Input")
    expect(container.textContent).toContain("Output")

    setInputValue(container, "wf-node-file-conversion-input-path", "/tmp/source.docx")
    expect(lastConfig(onConfigChange)).toMatchObject({ inputPath: "/tmp/source.docx" })

    clickByText(container, "Markdown file")
    expect(lastConfig(onConfigChange)).toMatchObject({ outputMode: "markdown-file" })

    setInputValue(container, "wf-node-file-conversion-output-directory", "/tmp/synapse-workflow-outputs/run-1")
    expect(lastConfig(onConfigChange)).toMatchObject({ outputDirectory: "/tmp/synapse-workflow-outputs/run-1" })

    clickByLabel(container, "OCR")
    expect(lastConfig(onConfigChange)).toMatchObject({ ocr: { enabled: true } })

    setInputValue(container, "wf-node-file-conversion-ocr-languages", "eng, chi_sim")
    expect(lastConfig(onConfigChange)).toMatchObject({ ocr: { languages: ["eng", "chi_sim"] } })

    setInputValue(container, "wf-node-file-conversion-ocr-max-pages", "3")
    expect(lastConfig(onConfigChange)).toMatchObject({ ocr: { maxPages: 3 } })
  })

  it("renders file conversion node card in the editor wrapper", async () => {
    const Wrapper = (nodeTypes as unknown as Record<string, React.ComponentType<{
      readonly id: string
      readonly data: Record<string, unknown>
      readonly selected?: boolean
    }>>).file_conversion

    expect(Wrapper).toBeTypeOf("function")

    const container = render(
      <Wrapper
        id="convert-1"
        selected
        data={{ name: "Convert", inputPath: "/tmp/source.docx", outputMode: "result" }}
      />,
    )

    expect(container.textContent).toContain("Convert")
    expect(container.textContent).toContain("/tmp/source.docx")
  })
})

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(element)
  })
  return container
}

function workflowWithFileConversionNode(config: Record<string, unknown>): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    nodes: [
      {
        id: "convert-1",
        name: "文件转换",
        type: "file_conversion",
        position: { x: 0, y: 0 },
        config,
      },
    ],
    edges: [],
    params: [],
  }
}

function lastConfig(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mock.mock.calls.at(-1)
  if (!call) throw new Error("Expected onConfigChange to be called")
  return call[1] as Record<string, unknown>
}

function setInputValue(container: HTMLElement, id: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`Input not found: ${id}`)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function clickByText(container: HTMLElement, text: string): void {
  const element = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text)
  if (!element) throw new Error(`Button not found: ${text}`)
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function clickByLabel(container: HTMLElement, label: string): void {
  const element = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  if (!element) throw new Error(`Control not found: ${label}`)
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}
