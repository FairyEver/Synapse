import { AlertTriangle, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SynapseRuleProjectInstallFormProps } from "../../types"

function HermesRuleProjectInstallForm({
  isSubmitting,
  onConfirm,
  onOpenChange,
  open,
  target,
}: SynapseRuleProjectInstallFormProps) {
  const isSoulMd = target?.targetPath?.endsWith("SOUL.md") ?? false

  function handleConfirm() {
    onConfirm({})
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>安装到 Hermes</DialogTitle>
        </DialogHeader>

        {isSoulMd && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">SOUL.md 是 Hermes 的人格文件</p>
              <p className="text-sm text-muted-foreground">
                SOUL.md 专门定义 Hermes 的语气和交互风格，不是为代码规则设计的。将规则安装到此处会与人格内容混合。建议改用"项目"范围，安装到项目的 .hermes.md 文件。
              </p>
              <p className="text-xs text-muted-foreground">超过 20,000 字符时内容会被截断。</p>
            </div>
          </div>
        )}

        {target && (
          <p className="break-all text-xs text-muted-foreground">
            目标文件：{target.targetPath}
          </p>
        )}

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
  RuleProjectInstallForm: HermesRuleProjectInstallForm,
  RuleGlobalInstallForm: HermesRuleProjectInstallForm,
} as const
