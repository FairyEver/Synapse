import { EDITOR_ICON_CLIP_STYLE, getEditorIconSrc } from "@/lib/editor-icons"
import { cn } from "@/lib/utils"
import type { SynapseEditorId } from "@/types/editor"

type EditorIconProps = {
  className?: string
  editorId: SynapseEditorId
}

function EditorIcon({ className, editorId }: EditorIconProps) {
  const iconSrc = getEditorIconSrc(editorId)

  if (!iconSrc) {
    return null
  }

  return (
    <img
      src={iconSrc}
      alt=""
      aria-hidden="true"
      className={cn("size-5 shrink-0", className)}
      style={EDITOR_ICON_CLIP_STYLE}
    />
  )
}

export { EditorIcon }
