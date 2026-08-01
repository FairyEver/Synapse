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
import type { SynapseRuleProjectInstallFormProps } from "../../types"
import type { ClaudeCodeRuleFrontmatter } from "./frontmatter"

function readClaudeCodeFrontmatterValues(value: unknown): ClaudeCodeRuleFrontmatter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>

  return {
    paths: typeof record.paths === "string" ? record.paths : "",
  }
}

function ClaudeCodeRuleProjectInstallForm({
  editorId,
  isSubmitting,
  onConfirm,
  onError,
  onOpenChange,
  open,
  target,
}: SynapseRuleProjectInstallFormProps) {
  const [paths, setPaths] = useState("")

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setPaths("")

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

        const existing = readClaudeCodeFrontmatterValues(values)

        if (existing) {
          setPaths(existing.paths)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "读取规则元数据失败。")
        }
      })

    return () => {
      cancelled = true
    }
  }, [editorId, onError, open, target])

  const handleConfirm = () => {
    onConfirm({ paths: paths.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>CC/Synapse 规则元数据</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="claude-code-frontmatter-paths">paths</Label>
            <Input
              id="claude-code-frontmatter-paths"
              value={paths}
              placeholder="src/api/**/*.ts, *.tsx"
              onChange={(event) => setPaths(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              多个模式用逗号分隔。留空则每次会话都加载；填写后仅在匹配文件进入 context 时加载。
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <p>当前组合：{paths.trim() ? "按路径匹配 — 仅在匹配文件进入 context 时加载。" : "全局生效 — 每次会话都注入。"}</p>
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
  RuleProjectInstallForm: ClaudeCodeRuleProjectInstallForm,
} as const
