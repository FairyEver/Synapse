import { useRef, type ClipboardEvent } from "react"
import { ImagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pastedTodoImages, todoImageAccept } from "./todo-image-files"

export function TodoImagePicker({ disabled, onSelect }: { disabled: boolean; onSelect: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <Button type="button" variant="ghost" data-track="todos.image.pick" disabled={disabled} onClick={() => input.current?.click()}>
      <ImagePlus data-icon="inline-start" />添加图片
    </Button>
    <input ref={input} type="file" accept={todoImageAccept} multiple hidden disabled={disabled}
      onChange={event => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ""
        if (files.length) onSelect(files)
      }} />
  </>
}

export function handleTodoImagePaste(event: ClipboardEvent, onSelect: (files: File[]) => void) {
  const files = pastedTodoImages(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  onSelect(files)
}
