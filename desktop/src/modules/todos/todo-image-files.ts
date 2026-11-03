import { TODO_IMAGE_MIME_TYPES, TODO_MAX_THUMBNAIL_BYTES, type TodoImageStageInput } from "@synapse/shared/todo-contracts"

export interface TodoDraftImage { id: string; file?: File }

export const todoImageAccept = [...TODO_IMAGE_MIME_TYPES, "image/vnd.microsoft.icon", ".ico"].join(",")

export function isTodoImageFile(file: File): boolean {
  return TODO_IMAGE_MIME_TYPES.some(mime => mime === file.type) || file.type === "image/vnd.microsoft.icon"
    || (!file.type && /\.(png|jpe?g|gif|webp|avif|ico)$/iu.test(file.name))
}

export function pastedTodoImages(clipboard: DataTransfer): File[] {
  const files = Array.from(clipboard.files).filter(file => file.type.startsWith("image/") || isTodoImageFile(file))
  if (files.length) return files
  return Array.from(clipboard.items).flatMap(item => {
    const file = item.kind === "file" && item.type.startsWith("image/") ? item.getAsFile() : null
    return file ? [file] : []
  })
}

export async function prepareTodoImage(imageId: string, file: File): Promise<TodoImageStageInput> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法生成缩略图")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const thumbnail = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.8))
    if (!thumbnail || thumbnail.type !== "image/webp" || thumbnail.size > TODO_MAX_THUMBNAIL_BYTES) throw new Error("无法生成缩略图")
    const [original, preview] = await Promise.all([file.arrayBuffer(), thumbnail.arrayBuffer()])
    return { imageId, original: new Uint8Array(original), thumbnail: new Uint8Array(preview) }
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}
