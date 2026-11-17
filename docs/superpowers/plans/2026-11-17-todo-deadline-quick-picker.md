# 待办截止时间快速选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面待办快速创建区提供“快捷 / 自定义”两段式截止时间弹层，快捷项点击即生效，自定义日期时间确认后生效。

**Architecture:** 纯函数生成并校验 6 个本地时间快捷项；待办模块新增受控的 `TodoDuePicker`，使用现有 Radix Popover、Tabs、Button、Input 和新增的 shadcn Calendar 源码组件。`TodoQuickCreate` 只替换截止时间入口，`useTodoEditor`、提醒及服务端契约保持不变。

**Tech Stack:** React 19、TypeScript 6、Radix UI、shadcn `radix-nova`、`react-day-picker`、`date-fns`、Vitest、Testing Library 风格 DOM 交互。

**Spec:** `/Users/liyang/Documents/code/github/Synapse/docs/superpowers/specs/2026-11-17-todo-deadline-quick-picker-design.md`

## Global Constraints

- 不改待办 API、数据模型、提醒服务、列表排序、IPC 或 MCP。
- 截止时间保存为本地分钟字符串，经现有 `todoLocalToUtc` 转为 UTC；不新增日期运行时依赖。
- 默认进入快捷视图；快捷项点击后立即写入并关闭，焦点回到触发器。
- 自定义日期时间只在点击“完成”后写入；取消和外部关闭不改变原值。
- 绝对项不晚于当前时间时原位禁用并显示“已过”；相对项始终可用。
- 编辑待办弹窗本次仍使用原生 `datetime-local`。
- 只使用现有主题 token 和 shadcn 组件，不新增硬编码颜色、内联样式或自定义动画。
- 不记录用户选择的绝对日期时间到 UI 日志；只记录稳定的事件键。

## Review Focus

- 系统时间正好为 12:00 或 17:00 时，对应绝对项必须禁用，不能因比较符号错误继续可选。
- 跨日、跨月和 23 点后打开自定义视图时，下一整点日期必须正确，不能生成过去时间。
- 快捷项和日历按钮都位于快速创建 `<form>` 内，任何选择动作都不能意外提交待办。
- 清除截止时间不能静默修改相对提醒；现有保存校验必须继续要求补齐截止时间或改选提醒。
- 弹层关闭、快速选择后和点击外部后，键盘焦点应回到截止时间触发器；禁选项仍需可被辅助技术识别。

---

### Task 1: Deadline Preset Calculation

**Files:**
- Create: `desktop/src/modules/todos/todo-deadline-presets.ts`
- Create: `desktop/src/modules/todos/__tests__/todo-deadline-presets.test.ts`

**Interfaces:**
- Produces: `TodoDeadlinePresetKey`, `TodoDeadlinePreset`
- Produces: `buildTodoDeadlinePresets(now: Date): TodoDeadlinePreset[]`
- Produces: `getTodoCustomDueDefault(now: Date): { date: Date; time: string }`

- [x] **Step 1: Write the failing preset tests**

```ts
import { describe, expect, it } from "vitest"
import { buildTodoDeadlinePresets, getTodoCustomDueDefault } from "../todo-deadline-presets"

describe("todo deadline presets", () => {
  it("builds six local deadline options from the current minute", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 10, 17, 9, 12, 45))
    expect(result.map(({ key, label, localValue, disabled }) => ({ key, label, localValue, disabled }))).toEqual([
      { key: "in-1-hour", label: "1 小时后", localValue: "2026-11-17T10:12", disabled: false },
      { key: "today-noon", label: "今天中午", localValue: "2026-11-17T12:00", disabled: false },
      { key: "today-17", label: "今天 17:00", localValue: "2026-11-17T17:00", disabled: false },
      { key: "tomorrow-noon", label: "明天中午", localValue: "2026-11-18T12:00", disabled: false },
      { key: "in-1-day", label: "1 天后", localValue: "2026-11-18T09:12", disabled: false },
      { key: "in-2-days", label: "2 天后", localValue: "2026-11-19T09:12", disabled: false },
    ])
  })

  it("disables absolute presets that are not after the current instant", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 10, 17, 17, 0))
    expect(result.map(({ key, disabled }) => [key, disabled])).toEqual([
      ["in-1-hour", false],
      ["today-noon", true],
      ["today-17", true],
      ["tomorrow-noon", false],
      ["in-1-day", false],
      ["in-2-days", false],
    ])
  })

  it("keeps noon available immediately before noon", () => {
    const noon = buildTodoDeadlinePresets(new Date(2026, 10, 17, 11, 59, 30))
      .find(({ key }) => key === "today-noon")
    expect(noon).toMatchObject({ localValue: "2026-11-17T12:00", disabled: false })
  })

  it("crosses month boundaries for relative and next-day presets", () => {
    const result = buildTodoDeadlinePresets(new Date(2026, 11, 31, 23, 20))
    expect(result.filter(({ key }) => ["tomorrow-noon", "in-1-day", "in-2-days"].includes(key)))
      .toMatchObject([
        { localValue: "2027-01-01T12:00" },
        { localValue: "2027-01-01T23:20" },
        { localValue: "2027-01-02T23:20" },
      ])
    expect(getTodoCustomDueDefault(new Date(2026, 11, 31, 23, 20))).toMatchObject({
      date: new Date(2027, 0, 1, 0, 0),
      time: "00:00",
    })
  })
})
```

- [x] **Step 2: Run the test and verify the module is missing**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todo-deadline-presets.test.ts`

Expected: FAIL because `../todo-deadline-presets` cannot be resolved.

- [x] **Step 3: Implement the helper**

在 `todo-deadline-presets.ts` 中用 `date-fns` 的 `addDays`、`addHours`、`format`、`set`、`startOfMinute`。以 `startOfMinute(now)` 为相对时间基准；绝对项目标时间 `<= now` 时禁用；`display` 使用 `M月d日 HH:mm`，`localValue` 使用 `yyyy-MM-dd'T'HH:mm`。

```ts
export type TodoDeadlinePresetKey =
  | "in-1-hour"
  | "today-noon"
  | "today-17"
  | "tomorrow-noon"
  | "in-1-day"
  | "in-2-days"

export type TodoDeadlinePreset = {
  key: TodoDeadlinePresetKey
  label: string
  display: string
  localValue: string
  disabled: boolean
}

export function buildTodoDeadlinePresets(now: Date): TodoDeadlinePreset[]
export function getTodoCustomDueDefault(now: Date): { date: Date; time: string }
```

- [x] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todo-deadline-presets.test.ts`

Expected: 4 tests pass.

- [x] **Step 5: Commit**

```bash
git add desktop/src/modules/todos/todo-deadline-presets.ts desktop/src/modules/todos/__tests__/todo-deadline-presets.test.ts
git commit -m "feat: 增加待办截止时间快捷项计算"
```

---

### Task 2: Calendar And Due Picker

**Files:**
- Create: `desktop/src/components/ui/calendar.tsx`
- Create: `desktop/src/modules/todos/todo-due-picker.tsx`
- Create: `desktop/src/modules/todos/__tests__/todo-due-picker.test.tsx`

**Interfaces:**
- Consumes: `buildTodoDeadlinePresets`, `getTodoCustomDueDefault`
- Produces:

```ts
export type TodoDuePickerProps = {
  open: boolean
  value: string
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
}

export function TodoDuePicker(props: TodoDuePickerProps): React.JSX.Element
```

- [x] **Step 1: Add the generated shadcn Calendar source**

严格对齐 `shadcn@latest add calendar` 的 `radix-nova` registry 内容新增 `desktop/src/components/ui/calendar.tsx`；把 registry 占位图标改为 `lucide-react` 的 `ChevronDownIcon`、`ChevronLeftIcon`、`ChevronRightIcon`，导入改为 `@/components/ui/button`。不运行会覆盖现有 `button.tsx` 的 CLI 写入。

- [x] **Step 2: Write the failing due picker tests**

测试文件 mock 掉 `@/components/ui/calendar`，用真实 Popover、Tabs、Button 与 Input：

```ts
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <button type="button" onClick={() => onSelect(new Date(2026, 10, 18))}>选择 11 月 18 日</button>
  ),
}))

it("keeps past absolute options visible but disabled and applies a quick option immediately", () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 17, 18, 10))
  // render open picker; assert today-noon and today-17 disabled + "已过"
  // click 1 小时后; expect onChange("2026-11-17T19:10") and onOpenChange(false)
})

it("applies the custom default only after completion", () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 17, 9, 12))
  // open custom tab; time input value is 10:00
  // click 完成; expect onChange("2026-11-17T10:00") and close
})

it("clears an existing deadline without changing other fields", () => {
  // value "2026-11-18T12:00"; open custom; click 清除截止时间
  // expect onChange("") and close
})
```

- [x] **Step 3: Run the test and verify the component is missing**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todo-due-picker.test.tsx`

Expected: FAIL because `../todo-due-picker` cannot be resolved.

- [x] **Step 4: Implement `TodoDuePicker`**

使用受控 Popover；每次打开重置为快捷视图并刷新当前时间。触发器使用现有 Button、Calendar 图标和当前截止值。弹层使用 `PopoverHeader`、`PopoverTitle`、Tabs、2 列快捷按钮和自定义视图。

- 快捷按钮 `type="button"`，点击时重新调用 `buildTodoDeadlinePresets(new Date())`，找到对应 key；已禁用则刷新状态且不写入。
- 快捷项显示标签与准确时间；禁用项文本追加“已过”。
- 自定义视图使用 Calendar、带可见 Label 的 `input type="time"`、清除、取消和完成。
- 完成按钮在日期或时间无效时禁用；有效时写入 `yyyy-MM-dd'T'HH:mm`。
- 时间输入按 Enter 等于完成，必须阻止外层快速创建表单提交。
- 所有非提交按钮明确 `type="button"`；关闭、快捷选择和完成均调用 `onOpenChange(false)`。

- [x] **Step 5: Run the test and verify it passes**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todo-due-picker.test.tsx`

Expected: 4 tests pass, including incomplete-time disabling and cancel-without-write.

- [x] **Step 6: Commit**

```bash
git add desktop/src/components/ui/calendar.tsx desktop/src/modules/todos/todo-due-picker.tsx desktop/src/modules/todos/__tests__/todo-due-picker.test.tsx
git commit -m "feat: 增加待办截止时间快捷选择弹层"
```

---

### Task 3: Quick Create Integration

**Files:**
- Modify: `desktop/src/modules/todos/todo-quick-create.tsx`
- Modify: `desktop/src/modules/todos/__tests__/todos-ui.test.tsx`

**Interfaces:**
- Consumes: `TodoDuePicker`

- [x] **Step 1: Write the failing quick-create tests**

在 `todos-ui.test.tsx` 增加：

```ts
it("sets a quick deadline and submits it without leaving the quick-add form", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 17, 9, 12))
  // render TodosModule; enter title
  // open [data-track="todos.quick-due"]; click [data-track="todos.quick-due.today-noon"]
  // expect the trigger to show 截止 11-17 12:00 and the popover to close
  // expect mocks.create not called yet; submit form
  // expect create dueAt === todoLocalToUtc("2026-11-17T12:00")
})

it("keeps passed quick times disabled when the deadline popover opens late", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 17, 18, 10))
  // open picker; assert today-noon and today-17 disabled, 1 小时后 enabled
})
```

每个用例在 `finally` 中恢复真实时间并卸载。

- [x] **Step 2: Run the tests and verify the old input behavior fails**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todos-ui.test.tsx`

Expected: the new cases FAIL because `todos.quick-due` still opens a raw input instead of the picker.

- [x] **Step 3: Integrate the picker**

在 `TodoQuickCreate`：

- 删除原截止时间展开面板、`dueId` 和对应 `datetime-local` Input。
- 保留 `showDue` 作为受控 open state；提醒选择为 `at_due` / `before_due` 且无截止时间时打开弹层。
- 操作行渲染 `<TodoDuePicker open={showDue} value={draft.due} disabled={saving} onOpenChange={setShowDue} onChange={(due) => change("due", due)} />`。
- 提醒字段仍在 `hasReminderTime` 时显示，不改变提醒保存规则。

- [x] **Step 4: Run the tests and verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todos-ui.test.tsx`

Expected: all existing and new cases pass.

- [x] **Step 5: Commit**

```bash
git add desktop/src/modules/todos/todo-quick-create.tsx desktop/src/modules/todos/__tests__/todos-ui.test.tsx
git commit -m "feat: 快速新建待办支持快捷截止时间"
```

---

### Task 4: Product Notes And Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Modify: `desktop/src/modules/todos/todo-quick-create.tsx` only if verification exposes a defect

**Interfaces:**
- Consumes: all prior tasks

- [x] **Step 1: Add the user-facing release note**

在“功能优化”下增加一条，说明快速创建待办时可一键选择今天中午、今天 17:00、明天中午、1 小时后、1/2 天后，也可通过日历精确选择；已过去的当天快捷时间会置灰。

- [x] **Step 2: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/todos/__tests__/todo-deadline-presets.test.ts src/modules/todos/__tests__/todo-due-picker.test.tsx src/modules/todos/__tests__/todos-ui.test.tsx
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:ui-tracking-coverage
```

Expected: all commands exit 0; typecheck has no errors; tracking coverage reports no uncovered new interactive controls.

- [x] **Step 3: Run the full desktop test suite and lint the touched files**

Run:

```bash
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop exec eslint src/components/ui/calendar.tsx src/modules/todos/todo-deadline-presets.ts src/modules/todos/todo-due-picker.tsx src/modules/todos/todo-quick-create.tsx src/modules/todos/__tests__/todo-deadline-presets.test.ts src/modules/todos/__tests__/todo-due-picker.test.tsx src/modules/todos/__tests__/todos-ui.test.tsx
```

Expected: full suite passes and ESLint exits 0. If unrelated failures exist, report them by name; do not alter unrelated code.

实际结果：ESLint 通过；全量套件两次均为 1156 个文件通过，仅 `electron/services/__tests__/mobile-workspace-files-service.test.ts` 的 “reads multiple baselines beside unrelated loose objects within independent budgets” 在并发负载下失败，单独运行通过，判断为既有非确定性失败。

- [x] **Step 4: Commit**

```bash
git add RELEASE_NOTES_PENDING.md docs/superpowers/specs/2026-11-17-todo-deadline-quick-picker-design.md docs/superpowers/plans/2026-11-17-todo-deadline-quick-picker.md
git commit -m "docs: 记录待办快捷截止时间设计与发布说明"
```

## 2026-11-17 后续调整

用户将快捷项改为六项，顺序为：1 小时后、今天下午（17:00）、明天下午（17:00）、本周日（17:00）、下周一（17:00）、本月末（17:00）。以下一个周一严格晚于今天为准。截止弹层收窄到 320px，自定义日历改为横向占满、32px 紧凑日期格和更小的周间距，默认时间改为下一个 17:00；以设计文档当前版本和对应测试为准。
