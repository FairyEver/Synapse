# HTTP 请求编辑器升级设计

## 概述

升级 `HttpRequestConfigForm` 共享组件，将原始文本输入替换为可视化编辑器，并扩展认证支持和请求测试能力。改一处两处受益（Scheduler + Workflow）。

## 组件架构

```
action-packages/builtin/http-request/
├── config.renderer.tsx    ← 更新：表单壳层，编排子组件
├── schema.ts              ← 更新：新增 auth 字段
├── kv-editor.tsx          ← 新增：通用 KV 表格编辑器
├── code-json-editor.tsx   ← 新增：CodeMirror JSON 编辑器
├── auth-fields.tsx        ← 新增：认证字段组件
└── request-tester.tsx     ← 新增：请求测试组件
```

调用方无需改动——Scheduler 通过 registry 获取，Workflow 通过 panel 获取，升级后自动受益。

## Schema 变更

新增可选 `auth` 字段，与现有字段共存：

```ts
export const httpRequestActionConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  bodyType: z.enum(["none", "json", "text"]),
  body: z.string().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
  // 新增
  auth: z.object({
    type: z.enum(["none", "bearer", "basic"]),
    bearerToken: z.string().optional(),
    basicUsername: z.string().optional(),
    basicPassword: z.string().optional(),
  }).optional(),
})
```

执行器逻辑：auth 配置在运行时合并到 headers（Authorization），不污染用户手动编辑的 headers 字段。

## 组件详情

### 1. KV Editor (`kv-editor.tsx`)

通用键值对表格编辑器，替代 Query / Headers 的 `KEY=value` Textarea。

```
key             value                    │
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Content-Type    [application/json   ] [×] │ ← 紧凑输入
Authorization   [Bearer xxx         ] [×]
              [+ 添加参数]                │ ← 链接样式

Props:
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
  keyPlaceholder?: string     // 默认 "键"
  valuePlaceholder?: string   // 默认 "值"
  addButtonLabel?: string     // 默认 "+ 添加"
  emptyMessage?: string       // 默认 "暂无数据"
```

空间措施：
- 每行 3 列：key 用 `<code>` 小字只读显示，value Input flex-grow，× 按钮 24px
- 无表格边框，用分隔线区分行
- 空 key 的行红色边框提示
- 添加按钮小字 + 链接色，不占高度
- 空状态显示 `emptyMessage`

### 2. JSON Editor (`code-json-editor.tsx`)

基于 `@uiw/react-codemirror` + `@codemirror/lang-json`，仅 bodyType 为 `json` 时渲染。

```
Props:
  value: string
  onChange: (value: string) => void
  minHeight?: string   // 默认 "120px"
  maxHeight?: string   // 默认 "360px"
  readonly?: boolean
```

能力：
- JSON 语法高亮
- 实时语法校验（红色波浪线）
- 代码折叠
- 右上角 [格式化] 按钮（调用 `JSON.stringify(JSON.parse(v), null, 2)`）
- 空值或非法时格式化按钮灰化

### 3. Auth Fields (`auth-fields.tsx`)

```
type: [无] [Bearer Token] [Basic Auth]

Bearer Token:
  Token: [_____________________________]  // type=password

Basic Auth:
  Username: [________________]
  Password: [________________]           // type=password
```

- ToggleGroup 选类型，选中后展现对应字段
- 字段值存到 `auth` 对象
- 选 `none` 时无额外 UI

### 4. Request Tester (`request-tester.tsx`)

```
[ 🧪 发送测试 ]  ← 按钮，点击后 loading

▸ 响应 (200 OK · 342ms)                 ← 自动展开
  { "status": "ok", "data": [...] }
```

实现：
- 渲染进程通过 IPC `synapse:http:testRequest` 发送请求
- 主进程复用 `electron/runtime/network/outbound-http.ts` 的执行逻辑
- 响应展示：状态码（颜色编码）+ 耗时 + 响应 body（JSON 格式化 / text 原文）
- 错误展示：网络错误 / 超时 / 无效 URL 的友好提示
- 响应区默认折叠，测试完成后自动展开

### 5. 表单壳层 (`config.renderer.tsx`)

```
┌─────────────────────────────────────────┐
│ [GET] [POST] [PUT] [PATCH] [DELETE]     │ ← 紧凑 toggle
│ URL: [______________________________]   │ ← placeholder
├─────────────────────────────────────────┤
│ 认证                                     │ ← 分隔线 + 标签
│ [无] [Bearer Token] [Basic Auth]         │
├─────────────────────────────────────────┤
│ Query                                    │
│ key    [value           ] [×]            │
│        [+ 添加参数]                      │
├─────────────────────────────────────────┤
│ Headers                                  │
│ key    [value           ] [×]            │
│        [+ 添加参数]                      │
├─────────────────────────────────────────┤
│ Body: [无] [JSON] [Text]                │ ← 紧凑 toggle
│ ┌─ CodeMirror / Textarea ──────────┐    │
│ │                                   │    │
│ └───────────────────────────────────┘    │
│ 超时分钟: [5]                            │
├─────────────────────────────────────────┤
│ [ 🧪 发送测试 ]                         │
│ ▸ 响应 ...               ← 折叠，发送后展开
└─────────────────────────────────────────┘
```

布局规则：
- Auth / Query / Headers 用**薄分隔线 + 标签头**分组，不设折叠交互。KV 编辑器空态极紧凑，固定可见不浪费空间。
- Method toggle 与 URL 之间无空行，共用顶部区域。
- Body 标签与 type toggle 同行，省一行。
- 仅「请求测试-响应」部分可折叠（默认折叠，测试后自动展开）。

### 6. Workflow Panel 调整 (`workflow-nodes/http-request/panel.tsx`)

移除外层的 `CollapsibleSection "请求配置"` 包裹。`HttpRequestConfigForm` 自身已经包含结构化的 section 布局，双层折叠既冗余又占空间。

## 空间优化原则

1. **不浪费一行**：Method toggle 和 URL 之间无空行，Method 用紧凑 `sm` 尺寸
2. **分隔线分组**：Auth/Query/Headers 用薄分隔线 + 标签头分组，不设折叠交互，KV 编辑器空态时仅一行「+添加」按钮
3. **紧凑间距**：字段间用 `gap-2` 而非 `gap-4`，内部用 `gap-1`
4. **KV 行紧凑**：删除按钮仅图标，无文字；key/value Input 用 `h-8` 而非默认 `h-10`
5. **JSON 编辑器**：120px 最小高度，360px 封顶带滚动
6. **无冗余标签**：Method 标签与 toggle 同行右边；Body 标签与 type toggle 同行
7. **仅响应预览可折叠**：测试结果可折叠，默认折叠，测试后自动展开

## 新增依赖

```json
{
  "@uiw/react-codemirror": "^4.23.0",
  "@codemirror/lang-json": "^6.0.1",
  "@codemirror/theme-one-dark": "^6.1.0"   // 暗色主题适配
}
```

## 执行器变更

### HTTP 请求执行器 (`action-packages/builtin/http-request/executor.main.ts`)

- 从配置读取 `auth` 字段
- 若 `auth.type !== "none"`，构建 Authorization header
  - bearer: `Bearer ${auth.bearerToken}`
  - basic: `Basic ${base64(auth.basicUsername + ":" + auth.basicPassword)}`
- 合并到 headers，原有同名 header 被 auth 覆盖

### Workflow 节点执行器 (`workflow-nodes/http-request/executor.main.ts`)

同上处理逻辑，保持行为一致。

## 测试集成

在 `config.renderer.tsx` 中新增的请求测试功能需要 IPC 通道：
- Channel 名：`synapse:http:testRequest`
- 请求：`HttpRequestActionConfig`
- 响应：`{ status, statusText, duration, headers, body }`

主进程新增 handler，复用 `electron/runtime/network/outbound-http.ts`。

## 消费者变更总结

| 消费者 | 需改？ | 改动内容 |
|--------|--------|----------|
| Scheduler `task-form-dialog.tsx` | 无 | 通过 registry 自动受益 |
| Workflow `panel.tsx` | 有 | 移除外层 CollapsibleSection 包裹 |
| `electron/action-runtime/builtin-actions.ts` | 无 | registry 自动受益 |
| HTTP 请求执行器（两个） | 有 | 添加 auth→headers 合并逻辑 |
| Workflow `schema.ts` | 无 | extend 自动继承 auth 字段 |
