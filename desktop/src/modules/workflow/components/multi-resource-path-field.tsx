import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../../config"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ChevronDown, ChevronUp, FolderOpen, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { WorkflowResourceEntryType } from "@/types/workflow"
import { useWorkflowResourcePicker } from "../hooks/use-workflow-resource-picker"

interface MultiResourcePathFieldProps {
  entryType: WorkflowResourceEntryType
  paths: string[]
  onChange: (paths: string[]) => void
  disabled?: boolean
  labelledBy?: string
}

export function MultiResourcePathField({ entryType, paths, onChange, disabled, labelledBy }: MultiResourcePathFieldProps) {
  const label = entryType === "file" ? "文件" : "文件夹"
  const { chooseResources } = useWorkflowResourcePicker()

  async function choosePaths(): Promise<void> {
    const selectedPaths = await chooseResources(entryType)
    if (!selectedPaths?.length) return

    const existing = new Set(paths.map(resourcePathIdentity))
    const additions: string[] = []
    let duplicateCount = 0
    for (const selectedPath of selectedPaths) {
      const identity = resourcePathIdentity(selectedPath)
      if (existing.has(identity)) {
        duplicateCount += 1
        continue
      }
      existing.add(identity)
      additions.push(selectedPath)
    }
    if (duplicateCount > 0) toast(`已忽略 ${duplicateCount} 个重复项`)
    if (paths.length + additions.length > WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS) {
      toast.error(`最多选择 ${WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS} 项`)
      return
    }
    if (additions.length > 0) onChange([...paths, ...additions])
  }

  function movePath(from: number, to: number): void {
    const next = [...paths]
    const [selectedPath] = next.splice(from, 1)
    if (!selectedPath) return
    next.splice(to, 0, selectedPath)
    onChange(next)
  }

  if (paths.length === 0) {
    return (
      <div role="group" aria-labelledby={labelledBy}>
        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => { void choosePaths() }} disabled={disabled}>
          <FolderOpen className="size-4" />选择{label}
        </Button>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-1" role="group" aria-labelledby={labelledBy}>
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{paths.length} / {WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS}</span>
        <div className="flex min-w-0 items-center">
          <Button type="button" variant="ghost" onClick={() => { void choosePaths() }} disabled={disabled}>
            <FolderOpen className="size-4" />添加{label}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onChange([])} disabled={disabled}>清空</Button>
        </div>
      </div>
      <ItemGroup className="min-w-0 gap-0 has-data-[size=xs]:gap-0">
        {paths.map((selectedPath, index) => (
          <Item key={`${selectedPath}-${index}`} size="xs" className="min-w-0 flex-nowrap px-0 py-0">
            <ItemContent className="min-w-0">
              <ItemTitle className="block w-full truncate font-normal" title={selectedPath}>{selectedPath}</ItemTitle>
            </ItemContent>
            <ItemActions className="shrink-0 gap-0">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled || index === 0}
                onClick={() => movePath(index, index - 1)}
                aria-label={`上移${label} ${index + 1}`}
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled || index === paths.length - 1}
                onClick={() => movePath(index, index + 1)}
                aria-label={`下移${label} ${index + 1}`}
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(paths.filter((_, pathIndex) => pathIndex !== index))}
                aria-label={`删除${label} ${index + 1}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </div>
  )
}

function resourcePathIdentity(resourcePath: string): string {
  const normalized = resourcePath.replaceAll("\\", "/")
  return getRendererPlatform() === "win32" ? normalized.toLocaleLowerCase() : normalized
}
