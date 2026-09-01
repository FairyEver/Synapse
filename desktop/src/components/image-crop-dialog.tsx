import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react"
import AvatarEditor, { useAvatarEditor } from "react-avatar-editor"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"

type ImageCropDialogRef = {
  /** 触发隐藏的 file input，打开系统文件选择器 */
  openFileSelector: () => void
  /** 直接以图片 URL 打开裁剪弹窗（用于粘贴、拖放等外部图片源） */
  openWithImage: (imageDataUrl: string) => void
}

type ImageCropDialogProps = {
  /** 输出的正方形图片边长（px） */
  outputSize?: number
  onCropped: (blob: Blob) => void
  children?: React.ReactNode
}

const ImageCropDialog = forwardRef<ImageCropDialogRef, ImageCropDialogProps>(
  function ImageCropDialog({ outputSize = 256, onCropped, children }, ref) {
    const [open, setOpen] = useState(false)
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0.5, y: 0.5 })
    const { ref: editorRef, getImageScaledToCanvas } = useAvatarEditor()
    const fileInputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      openFileSelector: () => {
        fileInputRef.current?.click()
      },
      openWithImage: (imageDataUrl: string) => {
        setImageSrc((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return imageDataUrl
        })
        setScale(1)
        setPosition({ x: 0.5, y: 0.5 })
        setOpen(true)
      },
    }))

    const handleFileSelect = useCallback(() => {
      fileInputRef.current?.click()
    }, [])

    const handleFileChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const url = URL.createObjectURL(file)
        setImageSrc((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        setScale(1)
        setPosition({ x: 0.5, y: 0.5 })
        setOpen(true)
        e.target.value = ""
      },
      []
    )

    const handleConfirm = useCallback(() => {
      const canvas = getImageScaledToCanvas()
      if (!canvas) return

      canvas.toBlob((blob: Blob | null) => {
        if (blob) onCropped(blob)
      }, "image/png")

      setOpen(false)
      if (imageSrc) URL.revokeObjectURL(imageSrc)
      setImageSrc(null)
    }, [imageSrc, onCropped, getImageScaledToCanvas])

    const handleCancel = useCallback(() => {
      setOpen(false)
      if (imageSrc) URL.revokeObjectURL(imageSrc)
      setImageSrc(null)
    }, [imageSrc])

    const handleWheel = useCallback((e: React.WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey) {
        // Pinch-to-zoom (ctrlKey is set by trackpad pinch gesture)
        setScale((prev) => {
          const delta = e.deltaY > 0 ? -0.05 : 0.05
          return Math.min(4, Math.max(1, prev + delta))
        })
      } else {
        // Two-finger scroll → pan
        const sensitivity = 0.002
        setPosition((prev) => ({
          x: Math.min(1, Math.max(0, prev.x + e.deltaX * sensitivity)),
          y: Math.min(1, Math.max(0, prev.y + e.deltaY * sensitivity)),
        }))
      }
    }, [])

    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {children ? (
          <span data-track="image-crop.file-select" data-track-native="true" onClick={handleFileSelect} className="cursor-pointer">
            {children}
          </span>
        ) : (
          <Button
            variant="outline"
            type="button"
            data-track="content-icon-image-select"
            onClick={handleFileSelect}
          >
            选择图片
          </Button>
        )}

        <Dialog
          data-track="content-icon-image-crop-dialog"
          open={open}
          onOpenChange={(v) => !v && handleCancel()}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>裁剪图片</DialogTitle>
              <DialogDescription>
                拖拽或双指滑动调整位置，捏合缩放图片
              </DialogDescription>
            </DialogHeader>

            {imageSrc && (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="overflow-hidden rounded-lg"
                  onWheel={handleWheel}
                >
                  <AvatarEditor
                    ref={editorRef}
                    image={imageSrc}
                    width={outputSize}
                    height={outputSize}
                    border={0}
                    borderRadius={0}
                    scale={scale}
                    position={position}
                    onPositionChange={setPosition}
                    rotate={0}
                    color={[0, 0, 0, 0.6]}
                  />
                </div>

                <div className="flex w-full items-center gap-2 px-1">
                  <span className="text-xs text-muted-foreground">缩放</span>
                  <Slider
                    data-track="content-icon-image-crop-scale"
                    min={100}
                    max={400}
                    step={1}
                    value={[Math.round(scale * 100)]}
                    onValueChange={([v]) => setScale(v / 100)}
                    className="flex-1"
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" data-track="content-icon-image-crop-cancel" onClick={handleCancel}>
                取消
              </Button>
              <Button data-track="content-icon-image-crop-confirm" onClick={handleConfirm}>确定</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
})

export { ImageCropDialog }
export type { ImageCropDialogRef, ImageCropDialogProps }
