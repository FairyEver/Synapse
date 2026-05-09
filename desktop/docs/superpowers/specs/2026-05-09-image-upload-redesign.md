# 图片上传区域重设计

## 概述

重新设计 Rules / Skills / Prompts 编辑模态框中"图片"标签页的图片上传区域，提升交互品质，新增剪贴板粘贴和拖放支持。

## 范围

仅限 `ContentAppearanceFields` 中 `TabsContent value="image"` 内部，不涉及"图标"标签页和 Tabs 整体结构。

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/modules/content/components/content-appearance-fields.tsx` | 重写图片 Tab 面板，内联 `ContentImageField` 组件 |
| `src/components/image-crop-dialog.tsx` | 新增 `openWithImage` 方法，允许外部注入图片源（绕过文件选择器） |
| `src/modules/content/hooks/use-content-icon-image.ts` | 新增 `pasteImage` 方法 |

## 空状态

虚线边框区域（`border-dashed border-2 rounded-lg`），居中排列：

- `ImageIcon` 图标（`text-muted-foreground`）
- 提示文案："上传图片作为内容图标"
- 两个按钮：`[选择文件]` `[从剪贴板粘贴]`

交互：
- 拖放文件到区域内 → 触发裁剪弹窗
- 点击"选择文件" → 文件选择器 → 裁剪弹窗
- 点击"从剪贴板粘贴" → `navigator.clipboard.read()` → 裁剪弹窗；无图片时 toast 提示
- Ctrl+V → 同剪贴板粘贴（隐藏功能，UI 不写文字）
- 拖放 hover 时边框变为 primary 色

## 已有图片状态

图片被一个带圆角边框的容器包裹，96×96，`object-cover`。

hover 时叠加半透明浮层（`bg-black/50`），居中两个白色图标按钮：
- "替换"（`ImageUp` 图标）→ 裁剪弹窗
- "移除"（`Trash2` 图标）→ 回到空状态

交互：
- 点击图片 → 替换 → 裁剪弹窗
- 拖放文件到预览区域 → 替换 → 裁剪弹窗
- 拖放 hover 时边框变为 primary 色
- Ctrl+V → 替换 → 裁剪弹窗（隐藏功能）

## 剪贴板支持

全部粘贴逻辑由 `ContentImageField` 层统一处理，不分散到 `ImageCropDialog`。

`ImageCropDialog` 新增：
- `openWithImage(imageDataUrl: string)` 公开方法，允许外部注入图片源打开裁剪弹窗

`useContentIconImage` 新增：
- `pasteImage()` 方法：尝试读取剪贴板，提取图片 Blob → 裁剪弹窗 → `handleIconImageChange`
- 剪贴板无图片时，调用 `toast.info("剪贴板中无图片")`

### "从剪贴板粘贴"按钮

调用 `navigator.clipboard.read()`，遍历 items 找到 `image/*` 类型。

### Ctrl+V 粘贴（隐藏功能）

`ContentImageField` 在挂载时注册 document `paste` 事件监听器，卸载时清理。
检测到粘贴图片时，同等处理 → 裁剪弹窗。

## 拖放流程

1. `onDragOver` 阻止默认行为 + 设置 `dropEffect`
2. 拖入时边框变 primary 色
3. `onDrop` 提取 `event.dataTransfer.files[0]`
4. 非图片文件提示错误
5. 图片文件 → 裁剪弹窗

## 裁剪弹窗

保持不变：隐藏 `<input type="file">`、`AvatarEditor`、缩放滑块、取消/确定按钮。

剪贴板路径也进入同一个裁剪弹窗，不单独处理。

## 数据流

```
用户操作（选择文件 / 粘贴 / 拖放 / 点击替换）
  → ImageCropDialog（裁剪 + 确认）
    → handleIconImageChange(blob)
      → 更新 preview（URL.createObjectURL）
      → 存储 bytes 到 iconImageBytesRef
  → 表单提交
    → iconImageBytes 附加到 payload
      → IPC → 主进程 → writeIconImageFile → icon.png
```

数据流与现有实现一致，不改变 IPC 或后端存储。

## 错误处理

- 剪贴板无图片 → toast 提示
- 拖放非图片文件 → toast 提示
- 文件读取失败 → toast 提示
- 裁剪取消 → 恢复之前状态（无操作）

## 验证

- 空状态 → 选择文件 → 裁剪 → 确认 → 预览出现 ✓
- 空状态 → 从剪贴板粘贴 → 裁剪 → 确认 → 预览出现 ✓
- 空状态 → Ctrl+V → 裁剪 → 确认 → 预览出现 ✓
- 空状态 → 拖放文件 → 裁剪 → 确认 → 预览出现 ✓
- 有图片 → hover 显示浮层 ✓
- 有图片 → 点击图片 → 替换裁剪 ✓
- 有图片 → 拖放替换 ✓
- 有图片 → Ctrl+V 替换 ✓
- 有图片 → 点击移除 → 回到空状态 ✓
- 剪贴板无图片 → 点击粘贴按钮 → toast 提示 ✓
- 拖放非图片文件 → toast 提示 ✓
