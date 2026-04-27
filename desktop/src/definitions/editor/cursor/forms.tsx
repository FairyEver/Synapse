import { useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { readEditorInstallFormValues } from "@/app-shell/content"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { SynapseRuleProjectInstallFormProps } from "../../types"
import type { CursorRuleFrontmatter } from "./frontmatter"

function readCursorFrontmatterValues(value: unknown): CursorRuleFrontmatter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>

  return {
    alwaysApply: record.alwaysApply === true,
    description: typeof record.description === "string" ? record.description : "",
    globs: typeof record.globs === "string" ? record.globs : "",
  }
}

function describeRuleType(frontmatter: CursorRuleFrontmatter): string {
  const hasDescription = frontmatter.description.trim().length > 0
  const hasGlobs = frontmatter.globs.trim().length > 0

  if (frontmatter.alwaysApply) {
    return "Always — 每次对话都注入，最省心但最耗 context。"
  }

  if (hasGlobs) {
    return "Auto Attached — 匹配到 globs 的文件进入 context 时自动加载。"
  }

  if (hasDescription) {
    return "Agent Requested — 由 Cursor 根据 description 判断何时加载。"
  }

  return "Manual — 仅在你主动 @ 引用时加载。"
}

function CursorRuleProjectInstallForm({
  editorId,
  item,
  isSubmitting,
  onConfirm,
  onError,
  onOpenChange,
  open,
  target,
}: SynapseRuleProjectInstallFormProps) {
  const [description, setDescription] = useState(item.description)
  const [globs, setGlobs] = useState("")
  const [alwaysApply, setAlwaysApply] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setDescription(item.description)
    setGlobs("")
    setAlwaysApply(false)

    if (!target) {
      return () => {
        cancelled = true
      }
    }

    void readEditorInstallFormValues({
      editorId,
      targetPath: target.targetPath,
    })
      .then(({ values }) => {
        if (cancelled) {
          return
        }

        const existing = readCursorFrontmatterValues(values)

        if (!existing) {
          return
        }

        setDescription(existing.description)
        setGlobs(existing.globs)
        setAlwaysApply(existing.alwaysApply)
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "读取规则元数据失败。")
        }
      })

    return () => {
      cancelled = true
    }
  }, [editorId, item.description, onError, open, target])

  const currentValues: CursorRuleFrontmatter = {
    alwaysApply,
    description,
    globs,
  }

  const handleConfirm = () => {
    onConfirm({
      alwaysApply,
      description: description.trim(),
      globs: globs.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cursor 规则元数据</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cursor-frontmatter-description">description</Label>
            <Input
              id="cursor-frontmatter-description"
              value={description}
              placeholder="一句话描述这条规则的用途"
              onChange={(event) => setDescription(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              让 Cursor 的 agent 判断何时需要这条规则。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cursor-frontmatter-globs">globs</Label>
            <Input
              id="cursor-frontmatter-globs"
              value={globs}
              placeholder="src/**/*.ts, *.tsx"
              onChange={(event) => setGlobs(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              多个模式用逗号分隔；留空即不按文件匹配。
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 px-3 py-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cursor-frontmatter-always-apply" className="cursor-pointer">
                alwaysApply
              </Label>
              <p className="text-xs text-muted-foreground">
                开启后每次对话都注入这条规则。
              </p>
            </div>
            <Switch
              id="cursor-frontmatter-always-apply"
              checked={alwaysApply}
              onCheckedChange={setAlwaysApply}
            />
          </div>

          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <p>当前组合：{describeRuleType(currentValues)}</p>
            {target ? (
              <p className="mt-1 break-all">目标文件：{target.targetPath}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={handleConfirm}>
            {isSubmitting ? (
              <>
                <LoaderCircle className="animate-spin" />
                安装中...
              </>
            ) : (
              "确定并安装"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const installFormDefinition = {
  RuleProjectInstallForm: CursorRuleProjectInstallForm,
} as const
