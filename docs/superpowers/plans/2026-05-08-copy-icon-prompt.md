# 复制图标提示词功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Rule/Skill/Prompt 内容添加"复制图标提示词"功能，点击后将系统提示词+内容正文复制到剪贴板，用于生成 AI 图标。

**Architecture:** 复用现有的 Content IPC 模块架构，添加新的 IPC 方法和模板文件。模板使用 Markdown 格式存储，运行时读取并替换占位符。

**Tech Stack:** Electron + TypeScript + React, Zod, shadcn/ui

---

## 文件结构

| 文件 | 用途 |
|-----|-----|
| `desktop/src/config/content-types/icon-prompt-templates.md` | 存储三种内容类型的系统提示词模板（新建） |
| `desktop/electron/services/content-service.ts` | 添加读取模板和生成提示词的方法（修改） |
| `desktop/electron/modules/content/ipc.ts` | 添加 `getIconPromptTemplate` IPC 方法（修改） |
| `desktop/electron/preload.ts` | 暴露 IPC 方法到渲染进程（修改） |
| `desktop/src/app-shell/content.ts` | 添加封装函数（修改） |
| `desktop/src/modules/content/hooks/use-content-download-actions.tsx` | 添加复制图标提示词功能（修改） |

---

## Task 1: 创建图标提示词模板文件

**Files:**
- Create: `desktop/src/config/content-types/icon-prompt-templates.md`

- [ ] **Step 1: 创建模板文件**

```markdown
# Rule 图标生成提示词模板

## 任务
为以下 Rule（AI 规则）设计一个应用图标。

## 内容类型说明
Rule 是规范 AI 行为的纪律性指令，强调边界、准则和指引。

## 视觉方向建议
- 盾牌（保护性规则）
- 标尺/刻度（精确规范）
- 指南针/罗盘（方向指引）
- 路标/箭头（行为导向）
- 框架/结构（系统边界）

## 设计要求
- **背景**：纯色或极微渐变（拒绝大幅度渐变）
- **主体**：单一视觉元素，突出主题
- **风格**：扁平化或简洁线条风
- **配色**：根据内容主题智能适配，避免高饱和冲突色
- **尺寸**：正方形比例
- **格式**：普通图片格式（非透明背景）
- **重要**：整个图片就是一个完整图标，无边框、无圆角、无内边距，不要"中央小图标四周留白"的效果

## 参考内容
标题：{{TITLE}}
---
{{CONTENT}}
---

---

# Skill 图标生成提示词模板

## 任务
为以下 Skill（AI 技能）设计一个应用图标。

## 内容类型说明
Skill 是赋予 AI 执行特定任务的能力，强调工具性、熟练度和行动力。

## 视觉方向建议
- 工具箱/扳手（实用工具）
- 闪电（快速执行）
- 齿轮/机械（精密运作）
- 魔杖/手势（神奇效果）
- 双手/动作（操作能力）

## 设计要求
- **背景**：纯色或极微渐变（拒绝大幅度渐变）
- **主体**：单一视觉元素，突出主题
- **风格**：扁平化或简洁线条风
- **配色**：根据内容主题智能适配，避免高饱和冲突色
- **尺寸**：正方形比例
- **格式**：普通图片格式（非透明背景）
- **重要**：整个图片就是一个完整图标，无边框、无圆角、无内边距，不要"中央小图标四周留白"的效果

## 参考内容
标题：{{TITLE}}
---
{{CONTENT}}
---

---

# Prompt 图标生成提示词模板

## 任务
为以下 Prompt（提示词模板）设计一个应用图标。

## 内容类型说明
Prompt 是触发 AI 特定输出或行为的对话模板，强调灵感、对话和创意触发。

## 视觉方向建议
- 对话气泡（交流沟通）
- 灯泡（灵感触发）
- 火花/星星（创意迸发）
- 输入光标/文本（文字交互）
- 问号/感叹号（疑问与启发）

## 设计要求
- **背景**：纯色或极微渐变（拒绝大幅度渐变）
- **主体**：单一视觉元素，突出主题
- **风格**：扁平化或简洁线条风
- **配色**：根据内容主题智能适配，避免高饱和冲突色
- **尺寸**：正方形比例
- **格式**：普通图片格式（非透明背景）
- **重要**：整个图片就是一个完整图标，无边框、无圆角、无内边距，不要"中央小图标四周留白"的效果

## 参考内容
标题：{{TITLE}}
---
{{CONTENT}}
---
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/config/content-types/icon-prompt-templates.md
git commit -m "feat: add icon prompt templates for rule/skill/prompt"
```

---

## Task 2: ContentService 添加模板读取方法

**Files:**
- Modify: `desktop/electron/services/content-service.ts`

- [ ] **Step 1: 在文件顶部添加导入**

在 `import { contentService }` 相关的导入后添加：

```typescript
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
```

- [ ] **Step 2: 在 ContentService 类中添加新方法**

在 `readIconImage` 方法之后（约第 228 行）添加：

```typescript
  async getIconPromptTemplate(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<string | null> {
    // 获取内容详情
    let detail: SynapseContentDetail
    try {
      detail = await this.getDetail(contentType, contentId)
    } catch {
      return null
    }

    // 读取模板文件
    const templatePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..", "..", "src", "config", "content-types", "icon-prompt-templates.md"
    )

    let templateContent: string
    try {
      templateContent = await readFile(templatePath, "utf-8")
    } catch {
      return null
    }

    // 解析对应类型的模板
    const sectionHeader = `# ${contentType.charAt(0).toUpperCase() + contentType.slice(1)} 图标生成提示词模板`
    const sections = templateContent.split(/^---$/m)
    
    let targetTemplate = ""
    for (const section of sections) {
      if (section.includes(sectionHeader)) {
        targetTemplate = section.trim()
        break
      }
    }

    if (!targetTemplate) {
      return null
    }

    // 替换占位符
    const finalPrompt = targetTemplate
      .replace(/{{TITLE}}/g, detail.title || "")
      .replace(/{{CONTENT}}/g, detail.content || "")

    return finalPrompt
  }
```

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/content-service.ts
git commit -m "feat: add getIconPromptTemplate method to ContentService"
```

---

## Task 3: IPC 模块添加新方法

**Files:**
- Modify: `desktop/electron/modules/content/ipc.ts`

- [ ] **Step 1: 在 methods 对象中添加新方法**

在 `readEditorInstallFormValues` 方法之后（约第 472 行）添加：

```typescript
    getIconPromptTemplate: {
      kind: "invoke",
      channel: "synapse:content:get-icon-prompt-template",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: anySchema,
      handler: async (_ctx, args: { contentType: SynapseContentType; id: string }) => {
        return contentService.getIconPromptTemplate(args.contentType, args.id)
      },
    },
```

- [ ] **Step 2: 重新生成 IPC channels**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm generate:ipc
```

预期输出：包含 `generated ${path}/ipc-channels.generated.ts`

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/modules/content/ipc.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: add getIconPromptTemplate IPC method"
```

---

## Task 4: Preload 添加桥接方法

**Files:**
- Modify: `desktop/electron/preload.ts`

- [ ] **Step 1: 在 IPC_CHANNELS 中添加新 channel**

在 `readEditorInstallFormValues` 之后（约第 41 行）添加：

```typescript
    "getIconPromptTemplate": "synapse:content:get-icon-prompt-template",
```

- [ ] **Step 2: 在 synapseBridge.content 中添加方法**

在 `readEditorInstallFormValues` 之后（约第 341 行）添加：

```typescript
    getIconPromptTemplate: invoke(IPC_CHANNELS.content.getIconPromptTemplate),
```

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/preload.ts
git commit -m "feat: expose getIconPromptTemplate in preload bridge"
```

---

## Task 5: App Shell Content 添加封装函数

**Files:**
- Modify: `desktop/src/app-shell/content.ts`

- [ ] **Step 1: 添加新函数**

在文件末尾（`updateSkill` 之后）添加：

```typescript
async function getIconPromptTemplate(
  contentType: SynapseContentType,
  id: string,
): Promise<string | null> {
  return requireContentBridge().getIconPromptTemplate({ contentType, id })
}
```

- [ ] **Step 2: 导出函数**

在 export 对象中添加：

```typescript
  getIconPromptTemplate,
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/app-shell/content.ts
git commit -m "feat: add getIconPromptTemplate wrapper in app-shell"
```

---

## Task 6: Hook 添加复制图标提示词功能

**Files:**
- Modify: `desktop/src/modules/content/hooks/use-content-download-actions.tsx`

- [ ] **Step 1: 导入 Image 图标和新函数**

在 imports 区域添加：

```typescript
import { Image } from "lucide-react"
import { getIconPromptTemplate } from "@/app-shell/content"
```

- [ ] **Step 2: 添加状态和方法**

在 hook 内部，找到 `isBusy` 之后的状态声明区域，添加：

```typescript
  const [isCopyingIconPrompt, setIsCopyingIconPrompt] = useState(false)
```

在 `handleCopy` 之后添加新方法：

```typescript
  const handleCopyIconPrompt = useCallback(async () => {
    if (isBusy || !canCopy) {
      return
    }

    setIsCopyingIconPrompt(true)

    try {
      await promise(
        async () => {
          const prompt = await getIconPromptTemplate(item.type, item.id)
          
          if (!prompt) {
            throw new Error("无法生成图标提示词。")
          }

          if (!navigator.clipboard?.writeText) {
            throw new Error("当前环境不支持复制到剪贴板。")
          }

          await navigator.clipboard.writeText(prompt)

          logger.info("Icon prompt copied to clipboard.", {
            contentId: item.id,
            contentType: item.type,
          })
        },
        {
          loading: "正在复制图标提示词...",
          success: "图标提示词已复制。",
          error: (error) => error instanceof Error ? error.message : "复制失败。",
        },
      )
    } catch (error) {
      logger.error("Copy icon prompt to clipboard failed.", {
        contentId: item.id,
        contentType: item.type,
        error,
      })
    } finally {
      setIsCopyingIconPrompt(false)
    }
  }, [canCopy, isBusy, item.id, item.type, logger, promise])
```

- [ ] **Step 3: 更新 auxiliaryMenuSections**

找到 `auxiliaryMenuSections` 的定义（约第 236 行），在 `canCopy` 部分添加新菜单项：

```typescript
      if (canCopy) {
        sections.push({
          key: "copy",
          items: [
            {
              key: "copy-content",
              label: "复制正文",
              disabled: isBusy,
              onSelect: () => {
                void handleCopy()
              },
            },
            {
              key: "copy-icon-prompt",
              label: "复制图标提示词",
              icon: <Image className="mr-2 h-4 w-4" />,
              disabled: isBusy,
              onSelect: () => {
                void handleCopyIconPrompt()
              },
            },
          ],
        })
      }
```

- [ ] **Step 4: 更新返回值**

在 return 对象中添加：

```typescript
    handleCopyIconPrompt,
    isCopyingIconPrompt,
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/content/hooks/use-content-download-actions.tsx
git commit -m "feat: add copy icon prompt functionality to content actions"
```

---

## Task 7: 测试功能

**Files:**
- None (manual testing)

- [ ] **Step 1: 启动开发服务器**

```bash
cd /Users/liyang/Documents/code/github/Synapse
cd desktop
pnpm dev
```

- [ ] **Step 2: 测试 Rule 的复制图标提示词**

1. 打开任意 Rule 详情页
2. 点击"更多操作"下拉菜单
3. 点击"复制图标提示词"
4. 粘贴到文本编辑器验证内容包含：
   - Rule 类型说明
   - Rule 的视觉方向建议
   - 设计要求
   - 该 Rule 的标题和内容

- [ ] **Step 3: 测试 Skill 的复制图标提示词**

1. 打开任意 Skill 详情页
2. 点击"更多操作"下拉菜单
3. 点击"复制图标提示词"
4. 粘贴验证内容包含 Skill 相关提示

- [ ] **Step 4: 测试 Prompt 的复制图标提示词**

1. 打开任意 Prompt 详情页
2. 点击"更多操作"下拉菜单（Prompt 的主操作是复制，所以菜单在复制按钮旁边）
3. 点击"复制图标提示词"
4. 粘贴验证内容包含 Prompt 相关提示

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "test: manually verified copy icon prompt feature"
```

---

## 最终检查

- [ ] 所有文件已修改并提交
- [ ] IPC channels 已重新生成
- [ ] 功能已手动测试通过
- [ ] 没有 TypeScript 编译错误（运行 `pnpm typecheck`）

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
pnpm typecheck
```

预期：无错误
