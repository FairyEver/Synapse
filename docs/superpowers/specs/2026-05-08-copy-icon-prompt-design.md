# 复制图标提示词功能设计文档

**日期**: 2026-05-08  
**功能**: 为 Rule/Skill/Prompt 内容添加"复制图标提示词"功能

---

## 1. 功能概述

在 Rule、Skill、Prompt 的内容操作菜单中新增"复制图标提示词"选项。点击后，将**系统提示词 + 内容正文**复制到剪贴板，用户可直接粘贴到 ChatGPT/Gemini 等生图模型生成图标。

## 2. 使用场景

用户希望为自定义的 Rule/Skill/Prompt 生成专属图标时：
1. 在内容详情页打开操作菜单
2. 点击"复制图标提示词"
3. 粘贴到 ChatGPT/Gemini
4. 下载生成的图片作为内容图标

## 3. UI 位置

| 内容类型 | 菜单位置 |
|---------|---------|
| Rule | 下拉菜单 → 复制正文 → **复制图标提示词** |
| Skill | 下拉菜单 → 复制正文 → **复制图标提示词** |
| Prompt | 下拉菜单 → 下载到本地 → **复制图标提示词** |

使用 [Image] 图标（来自 lucide-react）。

## 4. 系统提示词模板

模板文件位置：`desktop/src/config/content-types/icon-prompt-templates.md`

### 4.1 Rule 模板

```markdown
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
```

### 4.2 Skill 模板

```markdown
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
```

### 4.3 Prompt 模板

```markdown
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

### 4.4 占位符说明

| 占位符 | 替换内容 |
|-------|---------|
| `{{TITLE}}` | 内容标题 |
| `{{CONTENT}}` | 内容正文（Rule/Skill/Prompt 的 markdown 内容）|

## 5. 技术实现

### 5.1 数据流

```
用户点击"复制图标提示词"
    ↓
useContentDownloadActions.handleCopyIconPrompt()
    ↓
IPC: synapse:content:getIconPromptTemplate(type)
    ↓
主进程读取 icon-prompt-templates.md
    ↓
解析对应类型的模板
    ↓
渲染进程替换占位符 {{TITLE}}, {{CONTENT}}
    ↓
navigator.clipboard.writeText(finalPrompt)
    ↓
通知：图标提示词已复制
```

### 5.2 新增 IPC Channel

```typescript
// 主进程 → 渲染进程
synapse:content:getIconPromptTemplate(type: 'rule' | 'skill' | 'prompt'): Promise<string>
```

### 5.3 Hook 接口扩展

在 `useContentDownloadActions` 中新增：

```typescript
{
  // 新增方法
  handleCopyIconPrompt: () => Promise<void>

  // 新增菜单项（自动加入 auxiliaryMenuSections）
  // 在"复制正文"下方添加：
  // { key: "copy-icon-prompt", label: "复制图标提示词", icon: <Image /> }
}
```

### 5.4 文件变更清单

| 文件 | 变更类型 | 说明 |
|-----|---------|-----|
| `desktop/src/config/content-types/icon-prompt-templates.md` | 新增 | 三个类型的提示词模板 |
| `desktop/src/modules/content/hooks/use-content-download-actions.tsx` | 修改 | 新增 `handleCopyIconPrompt` 方法和菜单项 |
| `desktop/electron/ipc/content-handlers.ts` | 修改 | 新增 `getIconPromptTemplate` IPC handler |
| `desktop/electron/preload.ts` | 修改 | 暴露 IPC 方法到渲染进程 |
| `desktop/src/app-shell/content.ts` | 修改 | 新增 `getIconPromptTemplate` 封装函数 |

## 6. 错误处理

| 场景 | 处理 |
|-----|------|
| 模板文件读取失败 | 显示错误通知："读取图标提示词模板失败" |
| 剪贴板写入失败 | 显示错误通知："复制到剪贴板失败" |
| 内容未加载 | 禁用菜单项 |

## 7. 非功能性要求

- 模板文件在构建时被打包进应用
- 模板解析使用简单的字符串分割（按 `---` 分隔）
- 占位符替换使用简单的 `String.replace()`
- 不引入额外的 Markdown 解析依赖
