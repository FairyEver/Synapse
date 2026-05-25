import { useEffect, useState } from "react"
import { ExternalLink, Wrench } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
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
        <ItemGroup className="px-2 pb-2">
          {tools.map((tool) => (
            <Item
              key={tool.id}
              size="sm"
              className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-card"
              tabIndex={0}
              role="button"
              onClick={() => void handleOpenTool(tool)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                if (event.target !== event.currentTarget) return
                event.preventDefault()
                void handleOpenTool(tool)
              }}
            >
              <ItemMedia variant="icon" className="text-muted-foreground">
                <Wrench />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full min-w-0">
                  <span className="min-w-0 truncate">{tool.label}</span>
                </ItemTitle>
                <ItemDescription>{tool.description}</ItemDescription>
              </ItemContent>
              <ItemActions className="justify-end">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`打开${tool.label}`}
                  disabled={openingToolId !== null}
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleOpenTool(tool)
                  }}
                >
                  <ExternalLink />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </ScrollArea>
    </div>
  )
}
