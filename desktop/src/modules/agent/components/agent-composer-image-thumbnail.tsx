import { Button } from "@/components/ui/button"

type AgentComposerImageThumbnailProps = {
  readonly displayName: string
  readonly imageUrl: string | undefined
  readonly onOpen: (trigger: HTMLButtonElement) => void
}

function AgentComposerImageThumbnail({
  displayName,
  imageUrl,
  onOpen,
}: AgentComposerImageThumbnailProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 shrink-0 overflow-hidden rounded-md bg-background p-0 hover:bg-background disabled:opacity-100"
      aria-label={`预览图片 ${displayName}`}
      title={`预览 ${displayName}`}
      data-track="agent-attachment-preview-open"
      disabled={!imageUrl}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      ) : null}
    </Button>
  )
}

export { AgentComposerImageThumbnail }
export type { AgentComposerImageThumbnailProps }
