import { useEffect, useState } from "react"
import { ExternalLink, Wrench } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { ModuleContentPanel, ModulePage } from "@/components/module-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseToolCategory, SynapseToolDefinition, SynapseToolOutputKind } from "@/types/tools"
import { errorDiagnostic } from "@/modules/workflow/lib/error-utils"
import { FALLBACK_TOOL_DEFINITIONS } from "./registry"

const logger = createRendererLogger("tools")

export function ToolsModule() {
  const [tools, setTools] = useState<readonly SynapseToolDefinition[]>(FALLBACK_TOOL_DEFINITIONS)
  const [openingToolId, setOpeningToolId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadTools(): Promise<void> {
      try {
        const result = await requireBridgeDomain("tools").listTools()
        if (!cancelled) {
          setTools(result.tools)
        }
      } catch (error) {
        logger.warn("Tools list failed.", {
          boundary: "renderer.tools.list",
          ...errorDiagnostic(error),
        })
      }
    }
    void loadTools()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleOpenTool(tool: SynapseToolDefinition): Promise<void> {
    if (openingToolId) return
    setOpeningToolId(tool.id)
    try {
      await requireBridgeDomain("tools").openTool(tool.id)
    } catch (error) {
      logger.warn("Tool open failed.", {
        boundary: "renderer.tools.open",
        toolId: tool.id,
        ...errorDiagnostic(error),
      })
      toast.error("打开工具失败")
    } finally {
      setOpeningToolId(null)
    }
  }

  return (
    <ModulePage title="工具">
      <ModuleContentPanel>
        <Table className="min-w-[48rem] table-fixed">
          <colgroup>
            <col className="w-auto" />
            <col className="w-24" />
            <col className="w-36" />
            <col className="w-24" />
            <col className="w-20" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>工具</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>输入</TableHead>
              <TableHead>输出</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow
                key={tool.id}
                className="cursor-pointer"
                onClick={() => void handleOpenTool(tool)}
              >
                <TableCell className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 max-w-full justify-start px-0 py-0 font-medium hover:bg-transparent"
                        title={tool.title}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleOpenTool(tool)
                        }}
                      >
                        <span className="truncate">{tool.title}</span>
                      </Button>
                      <div className="truncate text-xs text-muted-foreground">{tool.description}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{toolCategoryLabel(tool.category)}</Badge>
                </TableCell>
                <TableCell className="truncate text-muted-foreground">
                  {toolInputLabel(tool)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {toolOutputLabel(tool.output.kind)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`打开 ${tool.title}`}
                    disabled={openingToolId !== null}
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleOpenTool(tool)
                    }}
                  >
                    <ExternalLink />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ModuleContentPanel>
    </ModulePage>
  )
}

function toolCategoryLabel(category: SynapseToolCategory): string {
  if (category === "conversion") return "转换"
  if (category === "content") return "内容"
  return "工具"
}

function toolOutputLabel(kind: SynapseToolOutputKind): string {
  if (kind === "markdown") return "Markdown"
  if (kind === "file") return "文件"
  return "文本"
}

function toolInputLabel(tool: SynapseToolDefinition): string {
  if (tool.input.kind === "file") return tool.input.extensions.join(" / ")
  return "输入"
}
