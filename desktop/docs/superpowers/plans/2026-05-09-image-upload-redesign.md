# 图片上传区域重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重设计 Rules/Skills/Prompts 编辑模态框中图片上传区域，新增剪贴板粘贴和拖放支持。

**Architecture:** ImageCropDialog 通过 forwardRef 暴露 `openFileSelector()` / `openWithImage()` 命令式 API；ContentImageField 在 content-appearance-fields.tsx 中作为内联组件，统一处理文件选择、拖放、粘贴三种图片入口，空状态显示虚线 drop zone，有图状态显示 hover 浮层预览卡片。

**Tech Stack:** React 19 + TypeScript 6 + shadcn/ui (radix-nova) + sonner toast + react-avatar-editor + lucide-react

---

### Task 1: ImageCropDialog — 暴露命令式 API

**Files:**
- Modify: `src/components/image-crop-dialog.tsx`

将 `ImageCropDialog` 改为 `forwardRef`，暴露两个方法供外部调用。

- [ ] **Step 1: 添加 forwardRef 和 useImperativeHandle**

在 `src/components/image-crop-dialog.tsx` 中，将函数组件改为 `forwardRef` 形式，暴露 `ImageCropDialogRef` 类型：

```typescript
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react"

type ImageCropDialogRef = {
  /** 触发隐藏的 file input，打开系统文件选择器 */
  openFileSelector: () => void
  /** 直接以图片 URL 打开裁剪弹窗（用于粘贴、拖放等外部图片源） */
  openWithImage: (imageDataUrl: string) => void
}

type ImageCropDialogProps = {
  outputSize?: number
  onCropped: (blob: Blob) => void
  children?: React.ReactNode
}
```

- [ ] **Step 2: 实现 forwardRef + useImperativeHandle**

```typescript
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
        setImageSrc(imageDataUrl)
        setScale(1)
        setPosition({ x: 0.5, y: 0.5 })
        setOpen(true)
      },
    }))

    // ... rest stays the same
```

- [ ] **Step 3: 更新导出**

```typescript
export { ImageCropDialog }
export type { ImageCropDialogRef, ImageCropDialogProps }
```

- [ ] **Step 4: 调整 trigger 逻辑 — children 模式不再自动绑定 file input click**

当前 children 模式下，`<span onClick={handleFileSelect}>` 直接触发 file input。保持此行为不变——"选择文件"按钮将通过 children 传入。

- [ ] **Step 5: 检查 TypeScript 编译**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm tsc --noEmit 2>&1 | head -30
```

确认无 ImageCropDialog 相关的类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/components/image-crop-dialog.tsx
git commit -m "refactor: expose imperative API from ImageCropDialog via forwardRef

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: ContentImageField — 空状态 drop zone + 剪贴板粘贴 + 拖放

**Files:**
- Modify: `src/modules/content/components/content-appearance-fields.tsx`

在 `ContentAppearanceFields` 文件的图片 Tab 面板中，内联一个新的 `ContentImageField` 组件，实现空状态的虚线 drop zone。

- [ ] **Step 1: 添加新 imports**

在 `content-appearance-fields.tsx` 顶部追加：

```typescript
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import { ImageIcon, ImageUp, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ImageCropDialog, type ImageCropDialogRef } from "@/components/image-crop-dialog"
import { cn } from "@/lib/utils"
```

- [ ] **Step 2: 定义 ContentImageField 组件的 props**

```typescript
type ContentImageFieldProps = {
  iconImagePreview: string | null
  iconImageError?: string
  onIconImageChange: (blob: Blob) => void
  onIconImageRemove: () => void
}
```

- [ ] **Step 3: 实现 ContentImageField 组件骨架**

```typescript
function ContentImageField({
  iconImagePreview,
  iconImageError,
  onIconImageChange,
  onIconImageRemove,
}: ContentImageFieldProps) {
  const cropDialogRef = useRef<ImageCropDialogRef>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  // --- 剪贴板粘贴（Ctrl+V 隐藏功能）---
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // 只在当前 Tab 可见时处理
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

  // --- 拖放处理 ---
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

  // --- 从剪贴板粘贴按钮 ---
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

  // --- 裁剪确认 → 交给父级 ---
  const handleCropped = useCallback((blob: Blob) => {
    onIconImageChange(blob)
  }, [onIconImageChange])

  // --- 空状态 ---
  if (!iconImagePreview) {
    return (
      <div className="flex flex-col gap-4">
        <div
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 transition-colors",
            isDragOver ? "border-primary" : "border-border",
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <ImageIcon className="size-8 text-muted-foreground" />
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

  // --- 有图状态（Task 3 实现）---
  return null // placeholder
}
```

注意：TabsContent 的 `data-invalid` 属性移到 `ContentImageField` 内部通过 `iconImageError` 控制。

- [ ] **Step 4: 替换图片 Tab 面板中的原有 JSX**

找到 `TabsContent value="image"`（约第 95-135 行），替换为：

```typescript
<TabsContent value="image" className="flex flex-col gap-4">
  <ContentImageField
    iconImagePreview={iconImagePreview}
    iconImageError={iconImageError}
    onIconImageChange={onIconImageChange}
    onIconImageRemove={onIconImageRemove}
  />
</TabsContent>
```

移除原有的 `Field` / `FieldContent` / `FieldError` 包裹——`ContentImageField` 内部自己管理布局。

- [ ] **Step 5: 清理不再需要的 imports**

原有的 `FieldContent` / `FieldError` (如果是唯一使用处就移除，否则保留)。

`Field` 和 `FieldContent` 仍在图标标签页中使用，保留。检查 `FieldError` 是否仅在图片标签页使用——在图标标签页中也有 `FieldError`，所以保留。

原有 `ImageCropDialog` import 替换为新版：`import { ImageCropDialog, type ImageCropDialogRef } from "@/components/image-crop-dialog"`。

- [ ] **Step 6: 检查 TypeScript**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/content/components/content-appearance-fields.tsx
git commit -m "feat: add drop zone empty state with paste and drag-drop support

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: ContentImageField — 已有图片状态 + hover 浮层

**Files:**
- Modify: `src/modules/content/components/content-appearance-fields.tsx`

在 `ContentImageField` 中实现有图状态的预览卡片与 hover 浮层。

- [ ] **Step 1: 实现有图状态 JSX**

替换 Task 2 中的 `return null` placeholder：

```typescript
  // --- 有图状态 ---
  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "group relative size-24 overflow-hidden rounded-lg border-2 transition-colors",
          isDragOver ? "border-primary" : "border-border",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          // 点击图片 → 替换
          cropDialogRef.current?.openWithImage(iconImagePreview)
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            cropDialogRef.current?.openWithImage(iconImagePreview)
          }
        }}
      >
        <img
          src={iconImagePreview}
          alt="图标预览"
          className="size-full object-cover"
        />

        {/* hover 浮层 */}
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            data-track="content-icon-image-replace"
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              cropDialogRef.current?.openWithImage(iconImagePreview)
            }}
          >
            <ImageUp className="size-5" />
            <span className="sr-only">替换</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            data-track="content-icon-image-remove"
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              onIconImageRemove()
            }}
          >
            <Trash2 className="size-5" />
            <span className="sr-only">移除</span>
          </Button>
        </div>
      </div>

      {/* 裁剪弹窗（替换时使用，通过 ref 触发） */}
      <ImageCropDialog ref={cropDialogRef} onCropped={handleCropped} />
    </div>
  )
```

注意：有图状态下，`ImageCropDialog` 不通过 children 传入 trigger，而是通过 ref 命令式调用。它仍需要渲染在组件树中，以便 Dialog 能正常打开。

空状态下的 `ImageCropDialog` children 是"选择文件"按钮；有图状态下的 `ImageCropDialog` 无 children（仅渲染隐藏的 file input + Dialog 壳）。

由于空状态和有图状态使用的是同一个 `cropDialogRef`，且两种情况互斥（要么空要么有图），ref 绑定到不同挂载周期的 `ImageCropDialog` 实例是安全的。

- [ ] **Step 2: 处理浮层中按钮点击不触发父级 onClick**

已在 Step 1 中通过 `e.stopPropagation()` 处理。"替换"按钮和"移除"按钮都阻止事件冒泡，防止触发容器的 `onClick` 替换逻辑。

- [ ] **Step 3: 检查 TypeScript 编译**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: 手动验证 checklist**

启动 dev 后逐项验证：

```
pnpm dev
```

- [ ] 空状态 → 点击"选择文件" → 系统文件选择器弹出 → 选图 → 裁剪弹窗 → 确认 → 预览出现
- [ ] 空状态 → 点击"从剪贴板粘贴" → 裁剪弹窗 → 确认 → 预览出现
- [ ] 空状态 → Ctrl+V（剪贴板有图片）→ 裁剪弹窗
- [ ] 空状态 → 拖放图片文件到虚线框 → 裁剪弹窗
- [ ] 空状态 → 拖放非图片文件 → toast "仅支持图片文件"
- [ ] 有图状态 → hover → 浮层（替换 + 移除）出现
- [ ] 有图状态 → 点击图片 → 裁剪弹窗替换
- [ ] 有图状态 → 点击浮层"替换" → 裁剪弹窗
- [ ] 有图状态 → 点击浮层"移除" → 回到空状态
- [ ] 有图状态 → 拖放替换 → 裁剪弹窗
- [ ] 有图状态 → Ctrl+V 替换 → 裁剪弹窗
- [ ] 空状态 → 点击"从剪贴板粘贴"无图片 → toast "剪贴板中无图片"

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/components/content-appearance-fields.tsx
git commit -m "feat: add preview card with hover overlay for existing image state

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
