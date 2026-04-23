# 仓库变量（Repository Variables）

类似 GitHub Secrets，为仓库定义键值对变量，在内容安装到编辑器时自动替换占位符。

---

## 问题场景

用户在 prompt / skill / rule 中写了包含敏感信息或环境相关值的内容（API Key、内部域名、项目路径等）。这些内容：

- 不应硬编码到仓库文件中（会被 Git 追踪、分享时泄露）
- 不同用户/环境的值不同（团队成员各有自己的 key）
- 需要在安装到编辑器时才注入真实值

---

## 核心概念

| 概念 | 说明 |
|------|------|
| 变量（Variable） | 一个 `name → value` 键值对，归属于某个仓库，可附带描述 |
| 占位符（Placeholder） | 内容正文中的 `${{ VARIABLE_NAME }}` 标记 |
| 替换（Substitution） | 安装时将占位符替换为变量值的过程 |

### 占位符语法

```
${{ variable_name }}
```

- `$` 前缀 + 双花括号包裹（与 GitHub Actions 一致，避免与 Handlebars/Mustache/Jinja2 的 `{{}}` 冲突）
- 变量名：字母、数字、下划线（`[A-Za-z0-9_]+`），大小写不敏感匹配
- 花括号内允许可选空格（`${{NAME}}` 和 `${{ NAME }}` 均可识别）
- 正则检测：`/\$\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g`
- 示例：`${{ API_KEY }}`、`${{internal_domain}}`、`${{ ProjectRoot }}`

---

## 功能设计

### 1. 变量管理（设置页）

在设置页新增「变量」分类，跟随当前活跃仓库切换（与「工具」分类依赖仓库上下文的模式一致）。

**数据结构：**

```typescript
type SynapseVariable = {
  name: string
  value: string
  description?: string
}

// 扩展 SynapseRepositoryConfig
type SynapseRepositoryConfig = {
  // ...existing fields
  variables?: SynapseVariable[]  // 新增
}
```

**变量名唯一性：** 同一仓库内变量名唯一（忽略大小写）。添加时如果已存在同名变量，阻止创建并提示"已存在同名变量。"。

**设置页 UI：**

- 分类：`variables`，图标 `Braces`，标签「变量」，描述「安装时替换占位符。」
- 列表顶部用 Badge（variant: secondary）显示当前仓库名称
- 变量列表用 `Card` 组件，每个变量一行，行间用 `Separator` 分隔（与 `SettingsGroup` 内的分隔模式一致）
- 每行：变量名（monospace）+ 值（默认明文）+ 描述（`text-muted-foreground`）+ 「修改」「删除」按钮（variant: ghost, size: sm）
- 顶部「添加变量」按钮（variant: outline, size: sm）
- 未选择仓库时显示提示「请先选择一个仓库」
- 有仓库但无变量时：空状态引导 + 「添加变量」按钮
- 预期规模：单仓库通常 < 20 个变量，无需分页

**添加变量弹窗（FormDialog）：**

- 标题：「添加变量」
- 字段：
  - 变量名称（Label: "名称"，Input，校验 `[A-Za-z0-9_]+`，placeholder: "API_KEY"）
  - 变量值（Label: "值"，Input，placeholder: "sk-proj-..."）
  - 描述（Label: "描述"，Input，可选，placeholder: "用于访问 OpenAI 服务的密钥"）
- 错误提示：`FieldError`，位于 footer 左侧（`sm:mr-auto`）
- 按钮：「取消」+「添加」/「添加中...」
- 校验错误文案：
  - 名称为空："先输入变量名称。"
  - 名称格式非法："变量名称只能包含字母、数字和下划线。"
  - 名称重复："已存在同名变量。"
  - 值为空："先输入变量值。"

**修改变量弹窗（FormDialog）：**

- 标题：「修改变量」
- 字段：变量名称（只读，Input disabled）+ 变量值 + 描述
- 按钮：「取消」+「保存」/「保存中...」

**删除确认（AlertDialog）：**

- 标题：「确认删除这个变量？」
- 描述：「删除后，包含 $\{{ {name} }} 占位符的内容在安装时将不再自动替换。」
- 按钮：「取消」+「删除」

### 2. 安装时替换

安装流程中，在写入文件前对内容执行占位符替换。

**替换函数（全局工具函数）：**

```typescript
// desktop/electron/lib/variable-substitution.ts

/** 检测内容中的所有占位符，返回去重的变量名列表（保留原始大小写） */
function detectPlaceholders(content: string): string[]

/** 用变量映射替换内容中的占位符，未匹配的保留原文 */
function substitutePlaceholders(
  content: string,
  variables: Record<string, string>
): string
```

渲染进程也需要调用 `detectPlaceholders`，因此该函数放在 shared lib 中，前后端共用。

**替换范围：**

- 内容正文（`content` 字段）：替换
- Frontmatter 字段（title / description 等）：不替换
- Skill 附件文件：v1 不替换，后续按需扩展

### 3. 安装确认弹窗（核心交互）

当待安装内容包含占位符时，在现有 install dialog 的安装动作中插入一个确认步骤。

**与现有 install dialog 的关系：**

用户在 `content-install-dialog` 中选好 scope、项目路径等，点击「安装」→ 检测占位符 → 有则弹出变量替换弹窗 → 确认后执行安装。变量弹窗是 install dialog 安装动作的中间步骤，不是独立入口。

**触发条件：** `detectPlaceholders(content).length > 0`

**弹窗规格（Dialog，sm:max-w-lg）：**

```
┌──────────────────────────────────────────────────────┐
│  确认变量替换                              [×]        │
│  以下占位符将在安装时被替换。                          │
│                                                        │
│  [My Prompts]  ← Badge secondary，当前仓库名           │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ API_KEY            用于访问 OpenAI 服务的密钥      │  │
│  │ [sk-proj-xxxxx                  ]  [已匹配]       │  │
│  │─────────────────────────────────────────────────  │  │
│  │ INTERNAL_DOMAIN                                   │  │
│  │ [▼ 手动输入         ]  [值...            ] ☐ 保存  │  │
│  │─────────────────────────────────────────────────  │  │
│  │ PROJECT_ROOT                                      │  │
│  │ [▼ 手动输入         ]  [值...            ] ☐ 保存  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ▶ 预览替换结果                                         │
│                                                        │
│                              [取消]  [安装]             │
└──────────────────────────────────────────────────────┘
```

**交互规则：**

1. 扫描内容中所有占位符（去重）
2. 与当前仓库变量按名称自动匹配：优先精确匹配，其次忽略大小写匹配
3. 已匹配的变量：
   - Input 中预填变量值，右侧显示 Badge「已匹配」
   - 用户可直接编辑 Input 中的值（临时覆盖，不影响仓库变量）
   - 如果用户修改了值，Badge 变为 Switch「更新」（开启后安装完成时更新仓库变量）
   - 如果变量有描述，显示在变量名右侧（`text-muted-foreground`）
4. 未匹配的变量：
   - 左侧 Select 组件：默认选项「手动输入」，其他选项为仓库中的已有变量名；选中已有变量后自动填入值到右侧 Input
   - 右侧 Input：手动输入值
   - 行尾 Switch「保存」（开启后安装完成时保存为仓库变量，使用占位符中的原始名称）
5. 「预览替换结果」可折叠区域（Collapsible）：展开后显示包含占位符的上下文片段，高亮替换前后变化，不展示全文
6. 两个操作按钮：
   - 「取消」— 关闭弹窗，回到 install dialog
   - 「安装」/「安装中...」— 用填写的值替换后安装（未填写的占位符保留原文）
7. 弹窗内容区域可滚动，最大高度 60vh
8. 变量列表项之间用 `Separator` 分隔

---

## 数据流

```
install dialog 打开
    │
    ▼
渲染进程：后台预加载 getContent（不阻塞 UI）
    │
    ▼
用户选择 scope / 项目路径 / 点击「安装」
    │
    ▼
渲染进程：detectPlaceholders(content)
    │
    ├─ 无占位符 → 正常安装流程（行为不变）
    │
    ├─ 预加载失败 → fallback 到正常安装流程（不阻塞安装）
    │
    └─ 有占位符 → 获取当前仓库变量，弹出确认弹窗
                      │
                      ▼
              用户填写/确认，点击「安装」
                      │
                      ▼
              渲染进程：调用 installToEditor IPC（payload 附带 variableSubstitutions）
                      │
                      ▼
              主进程：substitutePlaceholders(content, substitutions) → 写入文件
                      │
                      ▼
              渲染进程：安装成功后，如有开启「保存/更新」的项
                      │
                      ├─ 逐个调用 set-variable IPC
                      ├─ 成功 → 静默完成
                      └─ 失败 → toast 提示"变量保存失败"（不影响已完成的安装）
```

---

## 技术要点

### IPC 通道

```
synapse:repository:get-variables      // 获取当前仓库变量列表
synapse:repository:set-variable       // 添加或更新单个变量
synapse:repository:delete-variable    // 删除单个变量
```

### 安装 payload 扩展

```typescript
type SynapseInstallToEditorPayload = {
  // ...existing fields
  variableSubstitutions?: Record<string, string>  // 新增：变量名 → 值映射
}
```

保存/更新变量的操作不混入安装 payload，安装完成后由渲染进程单独调用 `set-variable` IPC。

### 替换逻辑位置

`content-install-service.ts` 中，在以下位置插入替换：

- single-file 安装：获取 `file.content` 后、序列化 frontmatter 前
- directory-overwrite 安装：获取 `detail.content` 后、写入文件前

如果 payload 中无 `variableSubstitutions` 或为空对象，跳过替换（向后兼容）。

### 预检流程

在渲染进程 `content-install-dialog.tsx` 中：

1. dialog 打开时，后台调用 `bridge.content.getContent()` 预加载内容（不阻塞 UI）
2. 预加载失败时静默忽略，后续跳过占位符检测，走正常安装流程
3. 用户点击「安装」时，对已加载的内容执行 `detectPlaceholders()`
4. 如果检测到占位符，调用 `bridge.repository.getVariables()` 获取仓库变量
5. 弹出确认弹窗，自动匹配同名变量
6. 用户确认后，将 `variableSubstitutions` 附加到安装 payload
7. 主进程通过 contentId 重新读取内容并执行替换后写入

---

## 边界情况

| 场景 | 处理 |
|------|------|
| 内容中无占位符 | 跳过整个变量替换流程，行为与现在完全一致 |
| 占位符存在但用户全部留空 | 保留原始占位符文本安装 |
| 预加载 getContent 失败 | 静默 fallback 到正常安装流程 |
| 仓库未配置任何变量 | 弹窗中所有占位符显示为手动输入状态 |
| 未选择活跃仓库 | 弹窗中无法自动匹配，全部手动输入，「保存」Switch 不可用 |
| 占位符名称含非法字符 | 不识别为占位符，保留原文 |
| 同一占位符出现多次 | 弹窗中只显示一次，替换时全部替换 |
| 变量名大小写不同 | 匹配时优先精确匹配，其次忽略大小写；保存时使用占位符中的原始名称 |
| 添加变量时名称已存在（忽略大小写） | 阻止创建，提示"已存在同名变量。" |
| 已匹配变量被用户临时修改 | 不自动更新仓库变量，需用户主动开启「更新」Switch |
| 安装成功但保存变量失败 | toast 提示"变量保存失败"，不影响安装结果 |
| Skill 附件中有占位符 | v1 不替换，保留原文 |

---

## 后续扩展（v2）

- 内容编辑器中占位符语法高亮/标记提示
- Skill 附件内容的占位符替换
- 变量敏感标记（标记后 UI 遮蔽显示）
- 转义语法支持（`\${{ NAME }}` 不替换）
- 从 `.env` 文件批量导入变量
