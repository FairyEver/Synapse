# 快速发布导入优化设计

## 背景

编辑器扫描详情页当前把外部 Skill / Rule 的主操作标记为“保存到仓库”。实际行为是读取本地内容，构造创建表单初始值，再打开 Synapse 的新建弹窗；用户仍需要在表单里点击“保存”。这个行为更接近“导入到仓库”，不是一键发布。

本次设计只覆盖三个已确认问题：

- 主操作语义从“保存/发布”收敛为“导入”。
- 名称重复时避免模糊的“继续保存”。
- frontmatter 解析异常或分类不匹配时给出可见提示。

不纳入本次范围：

- 已关联内容的本地版本更新仓库版本。
- Skill 附件预检和排除列表。
- 真正的一键无确认发布。

## 现有代码落点

- 扫描详情入口：`desktop/src/modules/editor-scan/components/scan-item-detail-dialog.tsx`
  - `publishAsNew` 调用 `bridge.editorScan.prepareQuickPublishDraft`。
  - `requestOpenContentCreate` 打开 Rule / Skill 创建弹窗。
  - `primaryActionLabel` 当前为“保存到仓库”或“从仓库中显示”。
- 快速导入 payload：`desktop/src/modules/editor-scan/lib/quick-publish.ts`
  - `parseFrontmatter` 手写解析 `key: value`。
  - `buildRuleQuickPublishPayload` / `buildSkillQuickPublishPayload` 静默丢弃未知分类。
- 创建弹窗承载：`desktop/src/modules/content/create-content-module.tsx`
  - 接收 `ContentOpenRequest.kind === "create"`。
  - 保存 `createInitialValue` 和 `createSourceLabel`。
- 创建弹窗通用壳：`desktop/src/modules/content/components/content-create-dialog.tsx`
  - 统一处理 sourceLabel、提交按钮、重复名称 AlertDialog。
  - 当前重复名称动作是“去修改 / 继续保存”。
- Rule 创建表单：`desktop/src/modules/rules/components/rule-create-dialog.tsx`
  - 负责名称重复检测、字段校验、提交。
- Skill 创建表单：`desktop/src/modules/skills/components/skill-create-dialog.tsx`
  - 负责名称重复检测、字段校验、附件表单。
- 类型定义：`desktop/src/types/editor-scan.ts`、`desktop/src/app-shell/content-navigation.ts`
  - 当前 quick publish draft 和 create request 没有携带导入提示信息。
- 现有测试：
  - `desktop/src/modules/editor-scan/__tests__/quick-publish.test.ts`
  - `desktop/electron/services/__tests__/editor-scan-service.test.ts`

## 产品设计

### 用户意图

用户在编辑器扫描页看到外部 Skill / Rule 时，想把它纳入 Synapse 仓库管理。这个动作的本质是“导入”。导入后用户还可以在 Synapse 中编辑、保存、安装到编辑器。

### 主操作命名

外部内容：

- 按钮：`导入到仓库`
- 动作：读取本地内容，打开新建弹窗并预填字段。

已关联 Synapse 内容：

- 按钮：`查看仓库内容`
- 动作：打开仓库详情。

关联内容不可用：

- 弹窗标题：`关联内容不可用`
- 主操作：`作为新内容导入`

### 重复名称处理

当创建表单检测到仓库内已有同名 Rule / Skill 时，弹窗必须让用户明确知道会发生什么。

弹窗文案：

- 标题：`名称已存在`
- 描述：`当前仓库已有同名内容。`
- 取消按钮：`去修改`
- 确认按钮：`另存为新内容`

第一版不提供“更新已有内容”。原因是更新需要构造 update payload、处理 `baseHistoryDirname`、附件差异、冲突检测和历史记录，不适合混入当前的导入语义修复。

### Frontmatter 元数据反馈

导入解析时保留“尽量预填，不阻断导入”的体验，但不再静默吞掉关键异常。

需要提示的情况：

- 检测到 frontmatter，但存在无法识别的行。
- `category` 字段存在，但不属于当前内容类型的分类。

提示文案：

- `元数据未完全识别，请检查已填内容。`
- `未识别分类，已留空。`

这两个提示显示在创建弹窗表单顶部，作为简短 Alert，不放长说明。

## UI / UE 设计

### 扫描详情页

保持现有 Dialog 结构和 shadcn 组件，不新增视觉系统。

变更点：

- `primaryActionLabel`：
  - `item.synapseContentId ? "查看仓库内容" : "导入到仓库"`
- fallback 弹窗确认按钮：
  - 从 `作为新内容保存` 改为 `作为新内容导入`
- 错误提示沿用现有 destructive Alert。

不改动项：

- 不新增介绍段落。
- 不改 Dialog 尺寸、颜色、层级。
- 不引入自定义颜色、内联样式或新基础组件。

### 创建弹窗

保持 `ContentCreateDialog` 作为统一壳。

变更点：

- 新增一个可选 `notices` prop，类型为数组。
- 当 `notices.length > 0` 时，在表单内容顶部渲染 `Alert` 列表。
- Alert 内容只显示必要文案。

推荐类型：

```ts
type ContentCreateNotice = {
  id: string
  message: string
}
```

不使用 severity 是为了保持本次范围小。当前两类提示都属于非阻断提示，统一用默认 Alert 即可。

### 重复名称弹窗

复用现有 `AlertDialog`。

只改文案：

- `名称重复` -> `名称已存在`
- `当前仓库中已存在同名的内容，继续保存可能导致混淆。` -> `当前仓库已有同名内容。`
- `继续保存` -> `另存为新内容`

这能准确表达结果：不会覆盖已有内容，而是创建另一条记录。

## 开发设计

### 数据结构

在 `desktop/src/modules/editor-scan/lib/quick-publish.ts` 中引入导入结果包装：

```ts
type QuickPublishNotice = {
  id: string
  message: string
}

type RuleQuickPublishBuildResult = {
  payload: SynapseCreateRulePayload
  notices: QuickPublishNotice[]
}

type SkillQuickPublishBuildResult = {
  payload: CreateSkillPayload
  notices: QuickPublishNotice[]
}
```

保留现有 payload builder 的核心逻辑，但让它返回 `{ payload, notices }`。为了降低改动面，也可以新增函数：

- `buildRuleQuickPublishImport`
- `buildSkillQuickPublishImport`

然后保留旧函数给测试或其他调用方使用。当前实际调用方只有扫描详情页和测试，因此也可以直接迁移。

### Frontmatter 解析

扩展 `parseFrontmatter` 的返回值：

```ts
type ParsedFrontmatter = {
  metadata: Record<string, string>
  body: string
  warnings: Array<"invalid-line">
}
```

规则：

- 没有 frontmatter：`warnings = []`。
- 有 frontmatter 且某一行非空、不是注释、也没有合法 `:`：记录 `invalid-line`。
- 仍然按当前轻量规则解析 `key: value`，不引入新依赖。

### 分类处理

把 `pickCategory` 改成同时返回分类和 notice 状态：

```ts
type PickCategoryResult = {
  category: string
  unknown: boolean
}
```

规则：

- 没有 `category`：`{ category: "", unknown: false }`
- 分类匹配：`{ category: value, unknown: false }`
- 分类不匹配：`{ category: "", unknown: true }`

当 `unknown === true` 时添加 notice：`未识别分类，已留空。`

### 创建请求传递

扩展 `desktop/src/app-shell/content-navigation.ts` 的 create request：

```ts
notices?: ContentCreateNotice[]
```

在 `desktop/src/modules/content/create-content-module.tsx` 增加状态：

- `createNotices`
- 打开 create request 时保存 notices。
- 关闭创建弹窗时清空 notices。
- 传给 `CreateDialog`。

### Rule / Skill 创建表单

在两个创建 dialog props 中增加：

```ts
notices?: ContentCreateNotice[]
```

传入 `ContentCreateDialog`。

### ContentCreateDialog

增加 `notices` prop，在 `FormDialog` children 顶部渲染：

```tsx
{notices.length > 0 ? (
  <div className="flex flex-col gap-2">
    {notices.map((notice) => (
      <Alert key={notice.id}>
        <AlertDescription>{notice.message}</AlertDescription>
      </Alert>
    ))}
  </div>
) : null}
{children}
```

使用现有 shadcn `Alert`，不写自定义样式。`gap-2` 属于布局类，可接受。

## 测试设计

更新 `desktop/src/modules/editor-scan/__tests__/quick-publish.test.ts`：

- 未知 category 返回空分类，并返回 `未识别分类，已留空。` notice。
- frontmatter 存在非法行时返回 `元数据未完全识别，请检查已填内容。` notice。
- 正常 frontmatter 不产生 notice。
- 现有 payload 字段保持不变。

可选增加组件测试时再覆盖：

- `ContentCreateDialog` 渲染 notices。
- 重复名称弹窗按钮文案为 `另存为新内容`。

## 验收标准

- 扫描详情页外部内容主按钮显示 `导入到仓库`。
- 已关联内容主按钮显示 `查看仓库内容`。
- 关联内容不可用时，fallback 确认按钮显示 `作为新内容导入`。
- 名称重复弹窗不再出现 `继续保存`，确认动作显示 `另存为新内容`。
- 未知分类不再静默丢失，创建弹窗顶部显示 `未识别分类，已留空。`。
- frontmatter 异常不阻断导入，创建弹窗顶部显示 `元数据未完全识别，请检查已填内容。`。
- 不新增自定义颜色、内联样式、CSS module、全局 CSS 或新视觉体系。
- 不启动开发服务器；通过源码检查和单元测试验证。

## 实施顺序

1. 修改 quick-publish builder 返回 notices，并补单元测试。
2. 扩展 content-navigation create request，传递 notices。
3. 扩展 create-content-module 状态和 CreateDialog props。
4. 在 ContentCreateDialog 渲染 notices，并调整重复名称弹窗文案。
5. 调整扫描详情页按钮文案。
6. 运行相关测试和类型检查。

## 风险与取舍

- 不引入 YAML 解析库：避免新增依赖，保持外科式修改；代价是复杂 YAML 仍不会完整解析，但会显示提示。
- 不做“更新已有内容”：避免把导入语义修复扩大成同步系统；后续可以单独设计 diff 和 update 流程。
- notices 只做非阻断提示：当前两类问题都不应该阻止导入，用户在表单里可自行修正。
