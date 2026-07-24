import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"

const toggleGroupCalls = vi.hoisted(() => [] as Array<{
  value?: string
  onValueChange?: (value: string) => void
}>)

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => <div data-slot="scroll-area" className={className}>{children}</div>,
}))

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({
    children,
    value,
    onValueChange,
    className,
  }: {
    children: ReactNode
    value?: string
    onValueChange?: (value: string) => void
    className?: string
  }) => {
    toggleGroupCalls.push({ value, onValueChange })
    return <div className={className}>{children}</div>
  },
  ToggleGroupItem: ({
    children,
    className,
    value,
  }: {
    children: ReactNode
    className?: string
    value: string
  }) => <button type="button" className={className} data-value={value}>{children}</button>,
}))

vi.mock("../../../../workflow-nodes/panel-registry", () => ({
  getPanel: () => function TestPanel() {
    return <div>节点配置</div>
  },
}))

vi.mock("../../../../workflow-nodes/registry", () => ({
  nodeTypeRegistry: {
    getManifest: () => ({
      title: "Prompt",
      icon: () => <span data-testid="node-icon" />,
    }),
  },
}))

vi.mock("../../../../workflow-nodes/provider-lookup-context", () => ({
  useProviderLookup: () => ({
    getProviderName: () => undefined,
    getModelName: () => undefined,
    getModelDisplayName: () => undefined,
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

import { NodeConfigPanel } from "../node-config-panel"

const definition: WorkflowDefinition = {
  id: "workflow-1",
  name: "Workflow",
  version: "v1",
  createdAt: 0,
  updatedAt: 0,
  layoutDirection: "horizontal" as const,
  nodes: [
    {
      id: "prompt-1",
      name: "Prompt",
      type: "prompt",
      position: { x: 0, y: 0 },
      config: { prompt: "Hello", variables: [] },
    },
  ],
  edges: [],
  params: [],
}

describe("NodeConfigPanel", () => {
  it("keeps selected-node padding inside the scroll content", () => {
    const html = renderToStaticMarkup(
      <NodeConfigPanel
        nodeId="prompt-1"
        definition={definition}
        projects={[]}
        onConfigChange={() => undefined}
        onNameChange={() => undefined}
      />,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="flex-1 p-3"')
    expect(html).toContain('class="p-3"')
  })

  it("keeps workflow settings padding inside the scroll content", () => {
    const html = renderToStaticMarkup(
      <NodeConfigPanel
        nodeId={null}
        definition={definition}
        projects={[]}
        onConfigChange={() => undefined}
        onNameChange={() => undefined}
      />,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="flex-1 p-3"')
    expect(html).toContain('class="space-y-4 p-3"')
    expect(html).toContain("布局方向")
    expect(html).toContain('data-value="horizontal"')
    expect(html).toContain('data-value="vertical"')
    expect(html).toContain('class="flex-1" data-value="horizontal"')
    expect(html).toContain('class="flex-1" data-value="vertical"')
  })

  it("ignores empty or unchanged direction values and delegates a real change", () => {
    const onLayoutDirectionChange = vi.fn()
    toggleGroupCalls.length = 0
    renderToStaticMarkup(
      <NodeConfigPanel
        nodeId={null}
        definition={definition}
        projects={[]}
        onConfigChange={() => undefined}
        onNameChange={() => undefined}
        onLayoutDirectionChange={onLayoutDirectionChange}
      />,
    )
    const onValueChange = toggleGroupCalls.at(-1)?.onValueChange

    onValueChange?.("")
    onValueChange?.("horizontal")
    onValueChange?.("vertical")

    expect(onLayoutDirectionChange).toHaveBeenCalledOnce()
    expect(onLayoutDirectionChange).toHaveBeenCalledWith("vertical")
  })
})
