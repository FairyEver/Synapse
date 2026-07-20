import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { ModelTierLabel } from "@/components/model-tier-label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { SynapseProviderPackageImportPreview } from "@/types/bridge"

type ProviderPackageImportDialogProps = {
  readonly preview: SynapseProviderPackageImportPreview | null
  readonly importing: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onImport: () => void
}

function ProviderPackageImportDialog({
  preview,
  importing,
  onOpenChange,
  onImport,
}: ProviderPackageImportDialogProps) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>导入供应商</DialogTitle>
        </DialogHeader>

        {preview ? (
          <TooltipProvider>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <ProviderPackagePreviewItem label="名称" value={preview.name} />
              <ProviderPackagePreviewItem label="ID" value={providerIdPreview(preview)} />
              <ProviderPackagePreviewItem label="类型" value={preview.category} />
              <ProviderPackagePreviewItem label="Key 字段" value={preview.apiKeyField} />
              <ProviderPackagePreviewItem label="请求地址" value={preview.baseUrl} />
              <ProviderPackagePreviewItem label={<ModelTierLabel tier="default" />} value={preview.model} />
            </div>
          </TooltipProvider>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={!preview || importing} onClick={onImport}>
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProviderPackagePreviewItem({
  label,
  value,
}: {
  readonly label: ReactNode
  readonly value?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate">{value || "-"}</div>
    </div>
  )
}

function providerIdPreview(preview: SynapseProviderPackageImportPreview): string {
  if (preview.sourceProviderId === preview.targetProviderId) {
    return preview.targetProviderId
  }
  return `${preview.sourceProviderId} -> ${preview.targetProviderId}`
}

export { ProviderPackageImportDialog }
