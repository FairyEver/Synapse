import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import { ImageIcon, ImageUp, Palette, Trash2 } from "lucide-react"

import {
  Field,
  FieldContent,
  FieldError,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageCropDialog, type ImageCropDialogRef } from "@/components/image-crop-dialog"
import { Button } from "@/components/ui/button"
import { ContentBackgroundPicker } from "@/modules/content/components/content-background-picker"
import { ContentIconPicker } from "@/modules/content/components/content-icon-picker"
import type { SynapseContentIconType } from "@/types/content"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type ContentImageFieldProps = {
  iconImagePreview: string | null
  iconImageError?: string
  onIconImageChange: (blob: Blob) => void
  onIconImageRemove: () => void
}

function ContentImageField({
  iconImagePreview,
  iconImageError,
  onIconImageChange,
  onIconImageRemove,
}: ContentImageFieldProps) {
  const cropDialogRef = useRef<ImageCropDialogRef>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // Ctrl+V paste listener (hidden feature)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!isContentImagePasteTarget(e.target, fieldRef.current)) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          e.preventDefault()
          const blob = items[i].getAsFile()
          if (blob) {
            const url = URL.createObjectURL(blob)
            cropDialogRef.current?.openWithImage(url)
          }
          return
        }
      }
    }
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [])

  // Drag handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("仅支持图片文件")
      return
    }
    const url = URL.createObjectURL(file)
    cropDialogRef.current?.openWithImage(url)
  }, [])

  // Clipboard paste button
  const handlePasteClick = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type)
            const url = URL.createObjectURL(blob)
            cropDialogRef.current?.openWithImage(url)
            return
          }
        }
      }
      toast.info("剪贴板中无图片")
    } catch {
      toast.info("无法读取剪贴板")
    }
  }, [])

  // Crop confirm callback
  const handleCropped = useCallback((blob: Blob) => {
    onIconImageChange(blob)
  }, [onIconImageChange])

  // --- Empty state ---
  if (!iconImagePreview) {
    return (
      <div ref={fieldRef} className="flex flex-col gap-2">
        <div
          data-track="content.icon.drop"
          data-track-native="true"
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 transition-colors",
            isDragOver ? "border-primary" : "border-border",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <ImageUp className="size-8 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">上传图片作为内容图标</span>
          <div className="flex gap-2">
            <ImageCropDialog ref={cropDialogRef} onCropped={handleCropped}>
              <Button
                variant="outline"
                size="sm"
                type="button"
                data-track="content-icon-image-select"
              >
                选择文件
              </Button>
            </ImageCropDialog>
            <Button
              variant="outline"
              size="sm"
              type="button"
              data-track="content-icon-image-paste"
              onClick={handlePasteClick}
            >
              从剪贴板粘贴
            </Button>
          </div>
        </div>
        {iconImageError && (
          <FieldError>{iconImageError}</FieldError>
        )}
      </div>
    )
  }

  return (
    <div ref={fieldRef} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border p-3">
        <img
          src={iconImagePreview}
          alt="内容图标"
          className="size-16 rounded-md border object-cover"
        />
        <div className="flex flex-1 justify-end gap-2">
          <ImageCropDialog ref={cropDialogRef} onCropped={handleCropped}>
            <Button
              variant="outline"
              size="sm"
              type="button"
              data-track="content-icon-image-replace"
            >
              <ImageUp data-icon="inline-start" />
              替换
            </Button>
          </ImageCropDialog>
          <Button
            variant="outline"
            size="sm"
            type="button"
            data-track="content-icon-image-remove"
            onClick={onIconImageRemove}
          >
            <Trash2 data-icon="inline-start" />
            移除
          </Button>
        </div>
      </div>
      {iconImageError && (
        <FieldError>{iconImageError}</FieldError>
      )}
    </div>
  )
}

type ContentAppearanceFieldsProps = {
  backgroundError?: string
  backgroundLabel?: string
  backgroundValue: string
  iconError?: string
  iconImageError?: string
  iconLabel?: string
  iconValue: string
  iconTypeValue: SynapseContentIconType
  iconImagePreview: string | null
  onBackgroundValueChange: (value: string) => void
  onIconValueChange: (value: string) => void
  onIconTypeChange: (value: SynapseContentIconType) => void
  onIconImageChange: (blob: Blob) => void
  onIconImageRemove: () => void
}

function ContentAppearanceFields({
  backgroundError,
  backgroundLabel = "背景色",
  backgroundValue,
  iconError,
  iconImageError,
  iconLabel = "图标",
  iconValue,
  iconTypeValue,
  iconImagePreview,
  onBackgroundValueChange,
  onIconValueChange,
  onIconTypeChange,
  onIconImageChange,
  onIconImageRemove,
}: ContentAppearanceFieldsProps) {
  return (
    <FieldSet className="gap-5">
      <FieldLegend className="sr-only">外观设置</FieldLegend>
      <Tabs
        data-track="content-appearance-mode"
        value={iconTypeValue}
        onValueChange={(v) => onIconTypeChange(v as SynapseContentIconType)}
      >
        <TabsList>
          <TabsTrigger value="icon">
            <Palette className="mr-1.5 size-3.5" />
            图标
          </TabsTrigger>
          <TabsTrigger value="image">
            <ImageIcon className="mr-1.5 size-3.5" />
            图片
          </TabsTrigger>
        </TabsList>

        <TabsContent value="icon" className="flex flex-col gap-5">
          <Field data-invalid={backgroundError ? true : undefined}>
            <FieldTitle>{backgroundLabel}</FieldTitle>
            <FieldContent>
              <ContentBackgroundPicker
                value={backgroundValue}
                onValueChange={onBackgroundValueChange}
              />
              <FieldError>{backgroundError}</FieldError>
            </FieldContent>
          </Field>

          <Field data-invalid={iconError ? true : undefined}>
            <FieldTitle>{iconLabel}</FieldTitle>
            <FieldContent>
              <ContentIconPicker
                tone={backgroundValue}
                value={iconValue}
                onValueChange={onIconValueChange}
              />
              <FieldError>{iconError}</FieldError>
            </FieldContent>
          </Field>
        </TabsContent>

        <TabsContent value="image" className="flex flex-col gap-2">
          <ContentImageField
            iconImagePreview={iconImagePreview}
            iconImageError={iconImageError}
            onIconImageChange={onIconImageChange}
            onIconImageRemove={onIconImageRemove}
          />
        </TabsContent>
      </Tabs>
    </FieldSet>
  )
}

export { ContentAppearanceFields }

export function isContentImagePasteTarget(target: EventTarget | null, root: HTMLElement | null): boolean {
  return target instanceof Node && Boolean(root?.contains(target))
}
