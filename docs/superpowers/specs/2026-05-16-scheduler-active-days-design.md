# Scheduler Active Days — Design Spec

## 概述

为定时任务新增"星期几"约束层（`activeDays`），独立于 cron/interval 触发计划，作为更高优先级的执行门卫。类似 iPhone 闹钟的周一到周日勾选，只有当天在勾选范围内时任务才允许触发。

## 需求

1. 适用于所有触发类型（cron 和 interval）
2. 独立于现有时间计算体系，优先级更高
3. 不在 activeDays 范围内的触发静默跳过
4. 新建任务必须至少勾选 1 天
5. 存量任务升级时自动补全选（行为不变）

## 数据模型

在 `ScheduledTask` 实体顶层新增字段：

```typescript
type ScheduledTask = {
  // ...existing fields
  activeDays: number[]  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
}
```

### 规则

| 场景 | activeDays 值 | 行为 |
|------|--------------|------|
| 新建任务，用户未勾选 | 表单校验阻止提交 | — |
| 新建任务，用户勾选周一到周五 | `[1,2,3,4,5]` | 仅工作日触发 |
| 存量任务升级 | `[0,1,2,3,4,5,6]` | 每天都触发（向后兼容） |
| 全选 | `[0,1,2,3,4,5,6]` | 等同于无约束 |

### 编码约定

- 使用 JS `Date.getDay()` 标准：0=Sunday, 1=Monday ... 6=Saturday
- 数组内元素无序，调度器内部排序后使用
- 持久化时存储为 JSON 数组

## 调度逻辑

### computeNextRunAt 扩展

在 `schedule-calculator.ts` 的 `computeNextRunAt()` 中，现有逻辑算出候选时间后加一层过滤：

```
1. 按现有逻辑算出 candidateTime
2. 取 candidateTime 的 weekday（考虑时区）
3. 检查 weekday 是否在 task.activeDays 中
4. 如果在 → 返回 candidateTime
5. 如果不在 → 向前推进到下一个合法日，重新用现有逻辑计算该日的触发时间
6. 对 interval 类型：跳到下一个合法日的 00:00 重新起算
7. 对 cron 类型：从下一个合法日 00:00 开始找下一个 cron 匹配时间
8. 递归检查新候选时间的 weekday（防止 cron 跳到更远的非法日）
9. 设置最大迭代次数（7 次）防止死循环
```

### 运行时防御

在 `task-scheduler-service.ts` 的 `runScheduled()` 中，timer 到期时加一道检查：

```typescript
const today = new Date().getDay()  // 考虑 timezone
if (!task.activeDays.includes(today)) {
  // 静默跳过，重新调度下一次
  reschedule(task)
  return
}
```

这是防御性检查——正常情况下 `computeNextRunAt` 已经跳过了非法日，但 timer 可能因为系统休眠等原因在错误的日期触发。

### 时区处理

- 如果 trigger 配置了 timezone，weekday 判断使用该时区
- 如果未配置 timezone，使用系统本地时区
- 与现有 cron 时区逻辑保持一致

## UI 设计

### 位置

在任务表单的"触发计划"section 内，紧跟 cron/interval 配置下方。

### 组件

7 个 toggle button 横排，类似 iPhone 闹钟：

```
活跃日
[日][一][二][三][四][五][六]
```

- 选中态：primary 背景色 + primary-foreground 文字
- 未选中态：muted 背景 + muted-foreground 文字
- 按钮形状：圆形或 rounded-full
- 新建时默认全选
- 表单校验：至少勾选 1 个，否则显示错误提示

### 组件实现

新建 `ActiveDaysInput` 组件：

```typescript
// src/modules/task-scheduler/components/active-days-input.tsx
type ActiveDaysInputProps = {
  value: number[]
  onChange: (days: number[]) => void
  error?: string
}
```

使用 shadcn `Toggle` 或 `Button` variant="outline" 实现每个日期按钮。

### 显示顺序

按照中文习惯，显示顺序为：一、二、三、四、五、六、日（周一在前，周日在后）。内部存储仍用 0-6 标准编码。

## MCP 接口

### scheduler_task_create

schema 新增可选字段：

```json
{
  "activeDays": {
    "type": "array",
    "items": { "type": "integer", "minimum": 0, "maximum": 6 },
    "minItems": 1,
    "maxItems": 7,
    "uniqueItems": true,
    "description": "Days of week when the task is allowed to run. 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. Defaults to all days if omitted."
  }
}
```

- 不传 → 默认 `[0,1,2,3,4,5,6]`

### scheduler_task_update

schema 新增可选字段（同上）：

- 传入 → 覆盖现有值
- 不传 → 不修改
- 传入空数组 → 校验失败

## 数据迁移

在 task-repository 的读取层做兼容处理：

```typescript
function hydrateTask(raw: unknown): ScheduledTask {
  const task = raw as ScheduledTask
  if (!task.activeDays) {
    task.activeDays = [0, 1, 2, 3, 4, 5, 6]
  }
  return task
}
```

不需要批量迁移写入——读取时补全即可。首次编辑保存时会自然持久化。

## 测试策略

### 单元测试

1. `schedule-calculator.test.ts`：
   - activeDays 全选 → 行为与之前一致
   - activeDays 只选工作日 → 周末的候选时间被跳过
   - activeDays 只选周六 → interval 任务跳到下一个周六
   - cron `0 9 * * *` + activeDays `[1,2,3,4,5]` → 只在工作日 9:00 触发

2. `task-repository.test.ts`：
   - 读取无 activeDays 的旧数据 → 自动补全选
   - 保存带 activeDays 的任务 → 正确持久化

3. `external-capabilities.test.ts`：
   - create 不传 activeDays → 默认全选
   - create 传空数组 → 校验失败
   - update 传有效 activeDays → 正确更新

### UI 测试

4. `ActiveDaysInput` 组件：
   - 点击切换选中/取消
   - 全部取消时显示错误
   - 默认全选状态正确

## 影响范围

| 文件 | 改动 |
|------|------|
| `src/types/task-scheduler.ts` | 新增 `activeDays` 字段 |
| `electron/services/task-scheduler/schedule-calculator.ts` | computeNextRunAt 加 activeDays 过滤 |
| `electron/services/task-scheduler/task-scheduler-service.ts` | runScheduled 加防御检查 |
| `electron/services/task-scheduler/task-repository.ts` | hydrate 时补全 activeDays |
| `electron/services/task-scheduler/external-capabilities.ts` | MCP create/update 支持 activeDays |
| `synapse-capabilities/shared/scheduler-domain.ts` | MCP schema 新增字段 |
| `src/modules/task-scheduler/components/active-days-input.tsx` | 新组件 |
| `src/modules/task-scheduler/components/task-form-dialog.tsx` | 集成 ActiveDaysInput |
