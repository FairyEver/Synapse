import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { errorDiagnostic } from "@/modules/workflow/lib/error-utils"
import type { SynapseToolDefinition } from "@/types/tools"
import { GeneratedToolForm } from "./generated-tool-form"
import { GeneratedToolResult } from "./generated-tool-result"

const logger = createRendererLogger("tools.builtin-tool-window")

export function BuiltinToolWindow(props: { readonly toolId: string }) {
  const [tool, setTool] = useState<SynapseToolDefinition | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)

  useEffect(() => {
    let canceled = false
    async function loadTool(): Promise<void> {
      try {
        const descriptor = await requireBridgeDomain("tools").getToolDescriptor(props.toolId)
        if (canceled) return
        setTool(descriptor)
        setValues(defaultValues(descriptor))
      } catch (error) {
        logger.warn("Tool descriptor loading failed.", {
          boundary: "renderer.tools.descriptor",
          toolId: props.toolId,
          ...errorDiagnostic(error),
        })
        if (!canceled) toast.error("读取工具失败")
      }
    }
    void loadTool()
    return () => {
      canceled = true
    }
  }, [props.toolId])

  const canRun = useMemo(() => {
    if (!tool || running) return false
    return tool.inputFields.every((field) => {
      if (!field.required) return true
      const value = values[field.id]
      return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null
    })
  }, [running, tool, values])

  async function selectFile(fieldId: string): Promise<void> {
    if (!tool) return
    try {
      const selection = await requireBridgeDomain("tools").selectFile({ toolId: tool.id, fieldId })
      if (selection.filePath) {
        setValues((current) => ({ ...current, [fieldId]: selection.filePath }))
        setResult(null)
      }
    } catch (error) {
      logger.warn("Tool file selection failed.", {
        boundary: "renderer.tools.select-file",
        toolId: tool.id,
        fieldId,
        ...errorDiagnostic(error),
      })
      toast.error("选择文件失败")
    }
  }

  async function selectDirectory(fieldId: string): Promise<void> {
    if (!tool) return
    try {
      const selection = await requireBridgeDomain("tools").selectDirectory({ toolId: tool.id, fieldId })
      if (selection.directoryPath) {
        setValues((current) => ({ ...current, [fieldId]: selection.directoryPath }))
        setResult(null)
      }
    } catch (error) {
      logger.warn("Tool directory selection failed.", {
        boundary: "renderer.tools.select-directory",
        toolId: tool.id,
        fieldId,
        ...errorDiagnostic(error),
      })
      toast.error("选择目录失败")
    }
  }

  async function run(): Promise<void> {
    if (!tool || !canRun) return
    setRunning(true)
    try {
      const nextResult = await requireBridgeDomain("tools").runTool({ toolId: tool.id, input: values })
      setResult(nextResult)
      toast.success(nextResult.ok ? "运行完成" : "运行失败")
    } catch (error) {
      logger.warn("Tool run failed.", {
        boundary: "renderer.tools.run",
        toolId: tool.id,
        ...errorDiagnostic(error),
      })
      toast.error("运行失败")
    } finally {
      setRunning(false)
    }
  }

  if (!tool) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">读取中</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <ScrollArea className="min-h-0 flex-1">
        <main className="grid gap-3 p-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{tool.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <GeneratedToolForm
                tool={tool}
                values={values}
                disabled={running}
                onChange={(fieldId, value) => {
                  setValues((current) => ({ ...current, [fieldId]: value }))
                  setResult(null)
                }}
                onSelectFile={(fieldId) => void selectFile(fieldId)}
                onSelectDirectory={(fieldId) => void selectDirectory(fieldId)}
              />
              <Button type="button" disabled={!canRun} onClick={() => void run()}>
                {running ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                运行
              </Button>
            </CardContent>
          </Card>
          {result ? <GeneratedToolResult result={result} /> : null}
        </main>
      </ScrollArea>
    </div>
  )
}

function defaultValues(tool: SynapseToolDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of tool.inputFields) {
    if ("defaultValue" in field && field.defaultValue !== undefined) {
      values[field.id] = field.defaultValue
    }
  }
  return values
}

