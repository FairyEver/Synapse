# 交互式终端自动化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动化按普通终端输入执行，保留可核验的完成/清理机制。
**Architecture:** Shell 原生 prompt 回执 → TerminalService 共用 PTY/真实网格/原样输入 → runner 持久化命令结果后处理 Shell 生命周期。
**Tech Stack:** TypeScript、node-pty、zsh/bash、现有 TerminalService 与 DataRepository。
**Spec:** `docs/superpowers/specs/2026-11-08-interactive-terminal-automation-design.md`

## Global Constraints
- 当前 main 原地修改，不新建分支/worktree，不修改生产配置，不启动应用/服务或打包发布。
- 命令不设程序白名单，不以非交互/包装命令静默回退；无法可靠确认应失败。
- 日志/退出码先保存后关闭；取消只影响本任务；保留运行历史，不重放。

## Review Focus
- prompt 重绘/嵌套 Shell/陈旧或跨会话回执不能假完成。
- 用户配置、alias、function、前后台作业与交互输入不能因包装改变语义。
- 真正执行前尺寸一致，不能用事后重排证明程序输出一致。
- 回执 token 不进入用户可读转录/云日志；取消要覆盖交互式 job-control 的子进程组。
- autoClose=false 应可继续操作，不是只读替身。

## Tasks
- [x] 1. 建立 Shell 回执、分片解析、状态保存的失败测试；实现 zsh/bash 与现有启动集成共用的 hook，实测真实 PTY。
- [x] 2. 建立同参数/布局/alias/function/多行/交互输入的失败测试；改 TerminalService 交互式创建、真实网格等待与原样输入，删除 -c/合成头。
- [x] 3. 改 runner 区分命令完成和 Shell 结束；覆盖日志、可继续输入、关闭顺序、超时、取消及受控 PTY 作业清理。
- [x] 4. 真实手动/自动同命令对照，修复差异；运行相关回归、类型、lint与约束检查。记录未验收平台/失败，更新指南及发布说明。提交以本计划与实现所在的本地 Git 提交为准。

## Ledger
- 调研：原实现使用非交互 -c，绕过交互启动配置并在80×24网格立即运行，显示修补不能修复语义差异。
- 原生 zsh 实测：precmd hook 中读取 `$?` 可取得命令状态，前一个 precmd 返回0不会覆盖后续 hook 看到的原始状态。原型创建的临时子进程已清理。
- 解析器需合并相邻普通输出，避免彩色提示符被拆成数千仿真任务；真实测试曾复现队列溢出，已修复并加专项回归。
- Bash 3.2 无 bracketed paste，改用原生 quoted-insert 传入同一多行编辑缓冲。实测函数定义、状态保留、中途sleep与最后非零状态，不能提前结束。
- 独立复核指出晚到的桌面尺寸无法唤醒既有等待终端，已改为输入前实际应用新采样；其后手机所有权回归先失败再通过，禁止覆盖已接管的手机尺寸。
- 自动化 runner 与手动 PTY 对照均使用源码和隔离运行上下文，不修改用户现有自动化。未启动应用、未构建安装或发布。
- 结果、复现命令、局限与已有 lint 问题见[验证记录](../specs/2026-11-08-interactive-terminal-automation-verification.md)。
