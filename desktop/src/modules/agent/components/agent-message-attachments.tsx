import { useMemo, useState } from "react"
import { File, Folder } from "lucide-react"
import { formatBytes } from "@synapse/shared"

import { Button } from "@/components/ui/button"
import { ImageLightbox, type ImageLightboxPreview } from "@/components/image-lightbox"
import type { SynapseAgentMessageAttachment } from "@/types/agent"
import { cn } from "@/lib/utils"
import { displayableImageUrl } from "./agent-tool-image-artifacts"

interface AgentMessageAttachmentsProps {
  readonly attachments: readonly SynapseAgentMessageAttachment[]
  readonly onOpenReference: (reference: string) => void
}

function AgentMessageAttachments({ attachments, onOpenReference }: AgentMessageAttachmentsProps) {
  const images = attachments.filter((attachment) => attachment.kind === "image")
  const paths = attachments.filter((attachment) => attachment.kind === "path")
  const [preview, setPreview] = useState<ImageLightboxPreview | null>(null)
  const [failedImageIds, setFailedImageIds] = useState<ReadonlySet<string>>(new Set())
  const lightboxImages = useMemo(() => images.map((image, index) => ({
    alt: image.name?.trim() || `图片 ${index + 1}`,
    src: displayableImageUrl(image.url),
  })), [images])

  return (
    <>
      <div className="space-y-3" data-agent-message-attachments="true">
        {images.length > 0 ? (
          <div
            className={cn("grid gap-1.5 overflow-hidden rounded-lg", imageGridClassName(images.length))}
            data-image-count={images.length}
            data-grid-columns={imageGridColumns(images.length)}
          >
            {images.map((image, index) => {
              const failed = failedImageIds.has(image.id)
              const previewImage = lightboxImages[index]
              if (!previewImage) return null
              return (
                <Button
                  key={image.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "block h-auto min-w-0 overflow-hidden rounded-lg p-0",
                    images.length === 1 ? "w-full" : "aspect-square w-full",
                  )}
                  aria-label={`预览${previewImage.alt}`}
                  disabled={failed}
                  onClick={(event) => {
                    setPreview({ images: lightboxImages, initialIndex: index, trigger: event.currentTarget })
                  }}
                >
                  {failed ? (
                    <span className="flex aspect-video w-full flex-col items-center justify-center gap-1 px-3 text-xs text-muted-foreground">
                      <span className="max-w-full truncate">{previewImage.alt}</span>
                      <span>图片无法加载</span>
                    </span>
                  ) : (
                    <img
                      src={previewImage.src}
                      alt={previewImage.alt}
                      className={cn(
                        "w-full object-cover",
                        images.length === 1 ? "aspect-video max-h-72" : "size-full",
                      )}
                      loading="lazy"
                      onError={() => {
                        setFailedImageIds((current) => new Set(current).add(image.id))
                      }}
                    />
                  )}
                </Button>
              )
            })}
          </div>
        ) : null}
        {paths.length > 0 ? (
          <div className="space-y-1">
            {paths.map((attachment) => {
              const Icon = attachment.entryType === "directory" ? Folder : File
              return (
                <Button
                  key={`${attachment.entryType}:${attachment.path}`}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full min-w-0 justify-start gap-2 px-1.5 py-1 text-left"
                  title={attachment.path}
                  onClick={() => onOpenReference(attachment.path)}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-5">{attachment.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {pathAttachmentMetadata(attachment)}
                    </span>
                  </span>
                </Button>
              )
            })}
          </div>
        ) : null}
      </div>
      {preview ? <ImageLightbox preview={preview} onClose={() => setPreview(null)} /> : null}
    </>
  )
}

function imageGridColumns(count: number): 1 | 2 | 3 {
  if (count === 1) return 1
  if (count <= 4) return 2
  return 3
}

function imageGridClassName(count: number): string {
  if (count === 1) return "grid-cols-1"
  if (count <= 4) return "grid-cols-2"
  return "grid-cols-3"
}

function pathAttachmentMetadata(
  attachment: Extract<SynapseAgentMessageAttachment, { kind: "path" }>,
): string {
  if (attachment.entryType === "directory") return "文件夹"
  const extension = attachment.name.split(".").at(-1)
  const type = extension && extension !== attachment.name ? extension.toUpperCase() : "文件"
  return attachment.byteSize === undefined ? type : `${type} · ${formatBytes(attachment.byteSize)}`
}

export { AgentMessageAttachments }
