# Workflow Run Parameter Presets Design

## Context

The current workflow run parameter dialog is too narrow for real parameter descriptions. Long labels wrap above compact inputs, which makes the form feel cramped and causes values such as local paths to be hard to inspect before running.

Users also repeat the same workflow parameter sets. They need a way to save the values they just entered as a reusable preset, then select that preset the next time they run the same workflow.

## Goals

- Make the workflow run parameter dialog wider and easier to scan.
- Add workflow-scoped run parameter presets.
- Let users run with current values without saving.
- Let users save current values as a preset and run in one flow.
- Let users select, modify, overwrite, and delete presets without losing current form values.
- Keep saved presets local to the workflow and separate from workflow definitions.

## Non-Goals

- Do not add a separate preset management page.
- Do not make presets global across workflows.
- Do not include presets in workflow package export or import.
- Do not save run results, reports, or node outputs in presets.
- Do not log preset values or parameter contents in tracking metadata.

## Dialog Layout

The dialog should use a medium working width, for example `sm:max-w-2xl`, and remain built from existing shadcn/Radix components and Tailwind token classes.

```text
┌────────────────────────────────────────────────────────┐
│ 设置运行参数                                      [×]   │
├────────────────────────────────────────────────────────┤
│ 预设                                                   │
│ [ 选择预设                                v ]  [删除]   │
├────────────────────────────────────────────────────────┤
│ 参数名 / 描述                         参数值            │
│ 多行文本，每一行是一个范文文件路径...   ┌──────────────┐ │
│                                        │ textarea     │ │
│                                        └──────────────┘ │
│                                                        │
│ 参考标题方案                         ┌──────────────┐  │
│                                      │ input        │  │
│                                      └──────────────┘  │
│                                                        │
│ JSON 输出目录                         ┌──────────────┐ │
│                                      │ input        │  │
│                                      └──────────────┘  │
├────────────────────────────────────────────────────────┤
│                         取消  保存为预设并运行  运行     │
└────────────────────────────────────────────────────────┘
```

Details:

- Use a stable two-column form layout on desktop: label/description on the left, control on the right.
- Let long labels wrap inside the label column instead of narrowing the input.
- Use `Textarea` for text parameters and `Input type="number"` for number parameters.
- Put parameters in a scrollable content area so the footer stays visible.
- Show the preset selector only when the workflow has parameters.
- Avoid explanatory UI copy. Keep labels operational: `预设`, `保存为预设并运行`, `运行`, `删除`.

## Preset Scope

Presets are scoped to one workflow.

```text
工作流 A
  ├─ 预设：日报标题
  └─ 预设：课程总结

工作流 B
  └─ 预设：部署参数
```

This avoids applying values to workflows with different parameter names, types, and semantics.

## Open Behavior

When the dialog opens:

```text
打开运行参数弹窗
   │
   ├─ 有上次填写值
   │     └─ 表单默认填上次填写值
   │
   ├─ 没有上次填写值
   │     └─ 表单填工作流参数默认值
   │
   └─ 顶部预设下拉加载当前工作流的预设
```

The existing in-memory `lastValues` behavior remains useful for immediate repeat runs. Presets add persistent named reuse across future opens.

## Selecting A Preset

```text
预设 [ 课程标题方案 v ]
        │
        ▼
用该预设的 values 覆盖当前表单
        │
        ├─ 用户直接点「运行」
        │     └─ 按当前表单值运行，不改预设
        │
        └─ 用户修改后点「保存为预设并运行」
              └─ 进入命名弹窗，可覆盖原名，也可另存新名
```

If a saved preset no longer matches the workflow parameters:

```text
预设里有，但当前工作流已删除的参数 → 忽略
当前工作流新增的参数 → 使用参数默认值
数字参数保存的是文本 "12" → 加载后仍按数字字段校验
```

## Save And Run

Primary run flow:

```text
用户填写参数
   │
   ├─ 点「运行」
   │     └─ 校验参数 → 直接运行，不保存预设
   │
   └─ 点「保存为预设并运行」
         │
         ├─ 参数校验失败 → 停在表单，显示字段错误
         │
         └─ 参数校验通过
              ▼
        ┌────────────────────────────┐
        │ 保存预设                    │
        │ 名称  [ 新预设 2026-06-23 ] │
        │                            │
        │            取消   保存并运行 │
        └────────────────────────────┘
```

Default preset name:

```text
新预设 2026-06-23
```

If that name already exists for the workflow, append a number:

```text
新预设 2026-06-23
新预设 2026-06-23 2
新预设 2026-06-23 3
```

Save must complete before the workflow starts. If saving fails, do not run.

## Duplicate Name Handling

Saving with an existing preset name requires explicit confirmation.

```text
输入名称
   │
   ├─ 名称不存在
   │     └─ 保存预设 → 运行
   │
   └─ 名称已存在
         ▼
     ┌────────────────────────────┐
     │ 覆盖预设？                  │
     │ 已存在同名预设。             │
     │                            │
     │            取消   覆盖并运行 │
     └────────────────────────────┘
```

No silent overwrite.

## Delete Preset

Delete is available for the currently selected preset.

```text
预设 [ 课程标题方案 v ] [删除]
                         │
                         ▼
              ┌────────────────────┐
              │ 删除预设？          │
              │                    │
              │      取消   删除    │
              └────────────────────┘
```

After successful deletion:

```text
删除成功
   ├─ 下拉回到「未选择预设」
   └─ 表单内容不清空
```

This protects the values the user is currently editing.

## Data Model

Store presets separately from workflow definitions:

```ts
interface WorkflowParamPreset {
  id: string
  workflowId: string
  name: string
  values: Record<string, string>
  createdAt: number
  updatedAt: number
}
```

Reason:

```text
工作流定义 = 可导入导出、可分享的流程结构
参数预设 = 用户本地运行习惯，可能含路径/私有文本
```

Recommended DataRepository namespace:

```text
workflow.param-presets
```

The namespace should use normal local persistence. Parameter preset values may contain local paths or private text, so logs, tracking, and diagnostics must avoid recording `values`.

## IPC And Service Boundary

```text
Renderer
  RunParamsDialog
    ├─ listPresets(workflowId)
    ├─ save preset
    ├─ delete preset
    └─ onConfirm(params)

Preload bridge
  window.synapse.workflowParamPresets.*

Main process
  WorkflowParamPresetService
    └─ DataRepository namespace: workflow.param-presets
```

Bridge methods:

```text
workflowParamPresets.list(workflowId)
workflowParamPresets.save({ workflowId, name, values, overwritePresetId? })
workflowParamPresets.delete(id)
```

Save behavior:

- Trim preset names.
- Reject empty names.
- Reject duplicate names in the same workflow unless `overwritePresetId` matches the existing preset.
- Update `updatedAt` when overwriting.
- Keep presets for different workflows independent.

Workflow deletion should remove that workflow's parameter presets.

## UI Implementation Boundary

The main renderer work belongs in `desktop/src/modules/workflow/components/run-params-dialog.tsx`, with small helpers extracted only if the component becomes hard to read.

Expected changes:

- Dialog width and scrollable form layout.
- Preset select area.
- Save-name dialog.
- Duplicate-overwrite confirmation.
- Delete confirmation.
- Error and disabled states for loading, saving, deleting, and submitting.

Do not introduce custom colors, custom CSS modules, inline styles, nested cards, or explanatory helper paragraphs.

## Tracking And Logs

Allowed metadata:

```text
workflowId
paramCount
numberParamCount
textParamCount
hasLastValues
selectedPresetId
savedPreset
```

Forbidden metadata:

```text
parameter values
preset values
local file paths from values
full user-entered text
```

## Tests

Renderer tests:

- Opens with persisted presets loaded for the workflow.
- Selects a preset and fills matching form fields.
- Ignores stale preset keys and defaults newly added workflow params.
- Runs without saving when `运行` is clicked.
- Validates params before opening the save-name dialog.
- Saves a new preset and then runs.
- Requires overwrite confirmation for duplicate names.
- Deletes the selected preset without clearing current form values.
- Disables conflicting actions while submitting or saving.

Main process tests:

- Lists presets by `workflowId`.
- Keeps same-name presets valid across different workflows.
- Rejects duplicate names in one workflow without overwrite.
- Overwrites the requested preset when confirmed.
- Deletes one preset by id.
- Deletes a workflow's presets when the workflow is deleted.

## Release Notes

Update `RELEASE_NOTES_PENDING.md` when implementing this feature because users will see a new run parameter preset capability and a changed workflow run dialog layout.
