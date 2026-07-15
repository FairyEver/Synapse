import { useId, useState } from "react"
import { Eye, EyeOff, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { FormDialog } from "@/components/form-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useSkillEnvSecretConfig,
  type SkillEnvSecretConfigField,
  type SkillEnvSecretConfigSaveOutcome,
} from "@/modules/content/hooks/use-skill-env-secret-config"
import type { SynapseContentMeta } from "@/types/content"
import {
  SkillEnvUpdateDialog,
  type SkillEnvUpdateScanGroup,
} from "../../../../app-capabilities/secrets/renderer/skill-env-update-dialog"

type SkillEnvSecretConfigDialogProps = {
  readonly item: SynapseContentMeta<"skill">
  readonly onOpenChange: (open: boolean) => void
}

const logger = createRendererLogger("content.skill-env-secret-config-dialog")

function errorDiagnostic(error: unknown): { readonly errorName?: string; readonly errorMessageLength: number } {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessageLength: error.message.length }
  }
  return { errorMessageLength: String(error).length }
}

function SkillEnvSecretConfigDialog({ item, onOpenChange }: SkillEnvSecretConfigDialogProps) {
  const formId = useId()
  const [discardOpen, setDiscardOpen] = useState(false)
  const [updateGroups, setUpdateGroups] = useState<readonly SkillEnvUpdateScanGroup[]>([])
  const config = useSkillEnvSecretConfig(item)
  const configOpen = updateGroups.length === 0

  const closeConfig = () => {
    if (config.saving) return
    if (config.hasUnsavedValues) {
      setDiscardOpen(true)
      return
    }
    onOpenChange(false)
  }

  const handleOutcome = (outcome: SkillEnvSecretConfigSaveOutcome) => {
    if (outcome.kind === "partial") {
      toast.error(outcome.savedCount > 0 ? "部分密钥保存失败，可重试。" : "保存失败，请重试。")
      return
    }
    if (outcome.kind === "scan_error") {
      toast.error("扫描关联 Skill 失败，请重试。")
      return
    }

    toast.success(outcome.savedCount > 0 || outcome.groups.length > 0 ? "已保存到密钥库" : "无需保存")
    if (outcome.groups.length > 0) {
      setUpdateGroups(outcome.groups)
    } else {
      onOpenChange(false)
    }
  }

  const footer = config.loadState === "ready" && config.fields.length > 0 ? (
    <>
      <Button type="button" variant="outline" disabled={config.saving} onClick={closeConfig}>
        取消
      </Button>
      <Button type="submit" disabled={config.saving || config.hasNameConflicts}>
        {config.saving ? "保存中" : "保存到密钥库"}
      </Button>
    </>
  ) : (
    <Button type="button" variant="outline" disabled={config.saving} onClick={closeConfig}>
      关闭
    </Button>
  )

  return (
    <>
      <Dialog
        open={configOpen}
        onOpenChange={(open) => {
          if (!open) closeConfig()
        }}
      >
        <FormDialog
          title="配置环境变量"
          description={item.title}
          contentClassName="sm:max-w-xl"
          footer={footer}
          onSubmit={(event) => {
            event.preventDefault()
            void config.save().then(handleOutcome)
          }}
        >
          {config.loadState === "loading" ? (
            <SkillEnvSecretConfigSkeleton />
          ) : config.loadState === "error" ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>加载失败</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={config.reload}>
                  <RefreshCw data-icon="inline-start" />
                  重新加载
                </Button>
              </EmptyContent>
            </Empty>
          ) : config.fields.length === 0 ? (
            <Empty className="min-h-40">
              <EmptyHeader>
                <EmptyTitle>没有可配置的环境变量</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {config.notice ? (
                <div className="flex items-center justify-between gap-3" role="alert">
                  <p className="text-sm text-destructive">{config.notice}</p>
                  {config.pendingScanNames.length > 0 && !config.hasSaveFailures ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={config.saving}
                      onClick={() => void config.retryScan().then(handleOutcome)}
                    >
                      重新扫描
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <FieldGroup className="gap-4">
                {config.fields.map((field, index) => (
                  <SkillEnvSecretField
                    key={field.name}
                    field={field}
                    inputId={`${formId}-${index}`}
                    saving={config.saving}
                    onReplace={() => config.replaceSecret(field.name)}
                    onReuse={() => config.reuseSecret(field.name)}
                    onToggleVisibility={() => config.toggleVisibility(field.name)}
                    onValueChange={(value) => config.setValue(field.name, value)}
                  />
                ))}
              </FieldGroup>
            </div>
          )}
        </FormDialog>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的值？</AlertDialogTitle>
            <AlertDialogDescription>关闭后，尚未保存到密钥库的输入将被清除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续配置</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onOpenChange(false)}>
              放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SkillEnvUpdateDialog
        groups={updateGroups}
        onQueueError={(error) => {
          logger.error("Failed to queue installed Skill environment updates.", errorDiagnostic(error))
          toast.error("更新失败，请重试。")
        }}
        onOpenChange={(open) => {
          if (!open) onOpenChange(false)
        }}
      />
    </>
  )
}

function SkillEnvSecretConfigSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="正在加载环境变量">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

function SkillEnvSecretField({
  field,
  inputId,
  saving,
  onReplace,
  onReuse,
  onToggleVisibility,
  onValueChange,
}: {
  readonly field: SkillEnvSecretConfigField
  readonly inputId: string
  readonly saving: boolean
  readonly onReplace: () => void
  readonly onReuse: () => void
  readonly onToggleVisibility: () => void
  readonly onValueChange: (value: string) => void
}) {
  const status = fieldStatus(field)
  const reusing = field.mode === "reuse"
  const nameConflict = field.mode === "name_conflict"

  return (
    <Field data-invalid={field.saveState === "failed" || nameConflict || undefined}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <FieldLabel htmlFor={inputId} className="min-w-0 truncate font-mono text-xs">
          {field.name}
        </FieldLabel>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant={status.variant}>{status.label}</Badge>
          {field.existingSecretName && field.existingHasValue && !nameConflict ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={saving}
              onClick={reusing ? onReplace : onReuse}
            >
              {reusing ? "替换" : "取消替换"}
            </Button>
          ) : null}
        </div>
      </div>

      <InputGroup>
        <InputGroupInput
          id={inputId}
          type={field.visible ? "text" : "password"}
          autoComplete="new-password"
          aria-invalid={field.saveState === "failed" || nameConflict || undefined}
          disabled={saving || reusing || nameConflict}
          placeholder={nameConflict ? "密钥名称冲突" : reusing ? "已保存到密钥库" : "输入值"}
          value={field.value}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {!reusing && !nameConflict ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={field.visible ? `隐藏 ${field.name}` : `显示 ${field.name}`}
              disabled={saving}
              onClick={onToggleVisibility}
            >
              {field.visible ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {nameConflict ? (
        <FieldError>已存在密钥 {field.existingSecretName}，名称必须与配置键完全一致。</FieldError>
      ) : null}
    </Field>
  )
}

function fieldStatus(field: SkillEnvSecretConfigField): {
  readonly label: string
  readonly variant: "destructive" | "outline" | "secondary"
} {
  if (field.saveState === "failed") return { label: "保存失败", variant: "destructive" }
  if (field.mode === "name_conflict") return { label: "名称冲突", variant: "destructive" }
  if (field.mode === "reuse") return { label: "已保存", variant: "secondary" }
  if (!field.value) return { label: field.touched ? "待保存" : "未设置", variant: "outline" }
  if (field.valueOrigin === "default" && field.value === field.defaultValue) {
    return { label: "使用默认值", variant: "secondary" }
  }
  return { label: "待保存", variant: "outline" }
}

export { SkillEnvSecretConfigDialog }
