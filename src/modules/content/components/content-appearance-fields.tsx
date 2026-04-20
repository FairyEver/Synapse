import { ImageIcon, Palette } from "lucide-react"

import {
  Field,
  FieldContent,
  FieldError,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageCropDialog } from "@/components/image-crop-dialog"
import { Button } from "@/components/ui/button"
import { ContentBackgroundPicker } from "@/modules/content/components/content-background-picker"
import { ContentIconPicker } from "@/modules/content/components/content-icon-picker"
import type { SynapseContentIconType } from "@/types/content"

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

        <TabsContent value="image" className="flex flex-col gap-4">
          <Field data-invalid={iconImageError && !iconImagePreview ? true : undefined}>
            <FieldContent>
              {iconImagePreview ? (
                <div className="flex items-center gap-3">
                  <img
                    src={iconImagePreview}
                    alt="图标预览"
                    className="size-16 rounded-lg object-cover"
                  />
                  <div className="flex gap-2">
                    <ImageCropDialog onCropped={onIconImageChange}>
                      <Button variant="outline" size="sm" type="button">
                        重新选择
                      </Button>
                    </ImageCropDialog>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={onIconImageRemove}
                    >
                      移除
                    </Button>
                  </div>
                </div>
              ) : (
                <ImageCropDialog onCropped={onIconImageChange} />
              )}
              {iconImageError && !iconImagePreview ? (
                <FieldError>{iconImageError}</FieldError>
              ) : null}
            </FieldContent>
          </Field>
        </TabsContent>
      </Tabs>
    </FieldSet>
  )
}

export { ContentAppearanceFields }
