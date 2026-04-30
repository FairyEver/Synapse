# Task Scheduler

<!-- Sources: desktop/src/modules/task-scheduler/index.tsx; desktop/src/modules/task-scheduler/types.ts; desktop/src/modules/task-scheduler/utils.ts; desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts; desktop/src/modules/task-scheduler/components/task-form-dialog.tsx; desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx; desktop/src/types/task-scheduler.ts; desktop/electron/modules/task-scheduler/ipc.ts; desktop/electron/services/task-scheduler/types.ts; desktop/electron/services/task-scheduler/task-scheduler-service.ts; desktop/electron/services/task-scheduler/schedule-calculator.ts; desktop/electron/services/task-scheduler/execution-service.ts; desktop/electron/services/task-scheduler/shell-action.ts -->

## 能做什么

Task Scheduler 用来创建和管理本地定时任务。任务列表展示名称、作用域、触发计划、上次运行、下次运行、状态、启用开关和操作按钮。

任务作用域可以是全局，也可以绑定到项目。触发方式支持 Cron 和固定间隔；当前排期计算会按任务创建时间计算固定间隔的下一次运行。执行内容是 shell 命令或脚本，Shell 可选 POSIX sh、cmd.exe 或 PowerShell。

你可以手动运行任务、停止运行中的任务、查看最近运行历史、启用或停用任务、编辑任务、删除任务。运行历史会显示触发来源、开始和结束时间、状态、退出码、错误、stdout 和 stderr。

## 怎么使用

点击“新建任务”，填写名称、作用域、触发计划和执行内容。项目作用域需要选择项目；命令或脚本内容不能为空。

在“运行设置”中可以填写环境变量，格式为每行一个 `KEY=value`。可以开启或关闭超时；开启时超时分钟数必须是正整数。默认新任务启用，默认超时为 30 分钟。

任务保存后会出现在列表中。点击运行按钮立即执行，点击历史按钮查看最近 100 次运行，运行中的记录可以点击停止。启用开关会立即更新任务启停状态。

## 注意事项

创建或更新 shell 任务时，会检查 `shell.exec` 权限；权限被拒绝时任务不会保存。执行时如果没有填写工作目录，会使用服务的默认工作目录。

同一个任务同时只能有一个运行实例。计划触发时如果该任务仍在运行，新触发会记录为 `skipped`。任务关闭后不会继续排期。

应用启动时会处理错过的计划：如果任务配置为“补跑一次”，会以 `missed_run` 记录补跑；否则会跳过错过的时间并安排下一次运行。
