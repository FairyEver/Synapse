import { useEffect, useState } from "react"
import { ExternalLink, Wrench } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseToolDefinition } from "@/types/tools"
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
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-2.5">
        <h2 className="text-sm font-semibold">工具</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 px-2 pb-2 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <Card key={tool.id} size="sm">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Wrench className="size-4 text-muted-foreground" />
                  <CardTitle>{tool.label}</CardTitle>
                </div>
                <CardDescription>{tool.description}</CardDescription>
                <CardAction>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={openingToolId !== null}
                    onClick={() => void handleOpenTool(tool)}
                  >
                    <ExternalLink data-icon="inline-start" />
                    打开
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
