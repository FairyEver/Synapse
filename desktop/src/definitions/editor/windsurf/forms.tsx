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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import type { SynapseRuleProjectInstallFormProps } from "../../types"
import type { WindsurfRuleFrontmatter, WindsurfRuleTrigger } from "./frontmatter"

function isWindsurfRuleTrigger(value: string): value is WindsurfRuleTrigger {
  return value === "always_on"
    || value === "model_decision"
    || value === "glob"
    || value === "manual"
}

function readWindsurfFrontmatterValues(value: unknown): WindsurfRuleFrontmatter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const trigger = typeof record.trigger === "string" && isWindsurfRuleTrigger(record.trigger)
    ? record.trigger
    : "model_decision"

  return {
    trigger,
    description: typeof record.description === "string" ? record.description : "",
    globs: typeof record.globs === "string" ? record.globs : "",
  }
}

function getTriggerSummary(frontmatter: WindsurfRuleFrontmatter): string {
  if (frontmatter.trigger === "always_on") {
    return "每次消息都会加载完整规则。"
  }

  if (frontmatter.trigger === "glob") {
    return "匹配文件被读取或编辑时加载。"
  }

  if (frontmatter.trigger === "manual") {
    return "仅在手动 @ 规则名时加载。"
  }

  return "先展示 description，由 Cascade 判断是否读取完整规则。"
}

function WindsurfRuleProjectInstallForm({
  editorId,
  item,
  isSubmitting,
  onConfirm,
  onError,
  onOpenChange,
  open,
  target,
}: SynapseRuleProjectInstallFormProps) {
  const [trigger, setTrigger] = useState<WindsurfRuleTrigger>("model_decision")
  const [description, setDescription] = useState(item.description)
  const [globs, setGlobs] = useState("")

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setTrigger("model_decision")
    setDescription(item.description)
    setGlobs("")

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

        const existing = readWindsurfFrontmatterValues(values)

        if (!existing) {
          return
        }

        setTrigger(existing.trigger)
        setDescription(existing.description)
        setGlobs(existing.globs)
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

  const currentValues: WindsurfRuleFrontmatter = {
    trigger,
    description,
    globs,
  }

  const handleConfirm = () => {
    onConfirm({
      trigger,
      description: description.trim(),
      globs: globs.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Windsurf 规则元数据</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="windsurf-rule-trigger">trigger</Label>
            <NativeSelect
              id="windsurf-rule-trigger"
              className="w-full"
              value={trigger}
              onChange={(event) => {
                const value = event.target.value
                if (isWindsurfRuleTrigger(value)) {
                  setTrigger(value)
                }
              }}
            >
              <NativeSelectOption value="model_decision">model_decision</NativeSelectOption>
              <NativeSelectOption value="glob">glob</NativeSelectOption>
              <NativeSelectOption value="always_on">always_on</NativeSelectOption>
              <NativeSelectOption value="manual">manual</NativeSelectOption>
            </NativeSelect>
          </div>

          {trigger === "model_decision" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="windsurf-rule-description">description</Label>
              <Input
                id="windsurf-rule-description"
                value={description}
                placeholder="一句话描述这条规则的用途"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          ) : null}

          {trigger === "glob" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="windsurf-rule-globs">globs</Label>
              <Input
                id="windsurf-rule-globs"
                value={globs}
                placeholder="src/**/*.ts, *.tsx"
                onChange={(event) => setGlobs(event.target.value)}
              />
            </div>
          ) : null}

          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <p>当前模式：{getTriggerSummary(currentValues)}</p>
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
  RuleProjectInstallForm: WindsurfRuleProjectInstallForm,
} as const
