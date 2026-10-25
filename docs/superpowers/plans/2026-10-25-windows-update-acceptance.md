# Windows 实际升级验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立 Windows 运行器上证明已发布的 1.0.79 能实际安装并升级到当前候选，且新版可启动、运行 PTY 与脚本。

**Architecture:** 仅手动触发的 Actions 工作流构建 Windows 候选。Node 验收程序在运行器临时目录安装旧版，通过回环更新源执行真实 NSIS 更新，读取实际进程、窗口、版本和合成加密夹具；不上传用户数据，不发布制品。

**Tech Stack:** Node 22、Electron、electron-updater、NSIS、GitHub Windows 2022、现有 yaml 依赖。

**Spec:** `docs/superpowers/specs/2026-10-23-desktop-electron-security-upgrade.md`、`docs/superpowers/specs/2026-07-21-desktop-update-handoff-design.md`。

## Global Constraints

- 当前分支开发；不创建分支或 worktree，不新增依赖。
- 工作流只有 `workflow_dispatch`，不发布、不部署、不修改公开更新源。
- macOS 最低 13；Electron 44.9.3；本任务不改变运行时或生产更新逻辑。
- 只操作运行器上本任务临时目录内的安装；清理按完整可执行路径限定。
- macOS 真实用户凭据仅在本机验证；Windows 只使用明确的合成加密夹具。

## Review Focus

- 公共元数据版本或制品路径不符时必须在安装前停止。
- 制品损坏或摘要不匹配时不得运行安装包。
- 旧进程退出不等于升级成功；必须核对安装后的真实版本及新版启动。
- 观察超时不得重启一次安装或把旧进程存活记为成功。
- 验收失败后的进程清理不能按名称误杀其他应用。

### Task 1: 可重复的 Windows 实际升级门禁

**Files:**
- Create: `.github/workflows/desktop-update-acceptance.yml`
- Create: `desktop/scripts/checks/windows-update-acceptance.mjs`
- Test: `desktop/scripts/checks/__tests__/windows-update-acceptance.test.mjs`
- Update: `docs/agents/repository-guide.md`

**Interfaces:**
- Consumes: 公开 `latest-windows.yml`、当前构建的 `desktop/release/latest.yml` 与实际 NSIS 安装包。
- Produces: 运行器 `windows-update-acceptance/evidence.json` 和日志，明确旧/新版本、原生更新、窗口、PTY、脚本与合成加密夹具结果。

- [ ] 先写元数据版本、路径、摘要与文件损坏的拒绝测试并确认失败。
- [ ] 实现 `parseWindowsMetadata(text, expectedVersion)` 与 `verifyFileSha512(file, expected)`，使用现有 yaml 解析器。
- [ ] 实现仅 Windows 可执行的真实安装、进程观察、回环源、升级和受限清理。
- [ ] 在实际安装的新版进程中检查窗口、PTY 与旧版生成的合成加密夹具，并执行既有打包脚本运行时检查。
- [ ] 添加仅手动触发的工作流，保留证据；同步仓库验证入口说明。
- [ ] 运行 Node 测试、语法与工作流 YAML 检查，审查并提交；推送后执行 Windows 验收和针对同一提交的 CI。

### Task 2: 归档真实 macOS 证据并继续发布

**Files:**
- Update: `docs/superpowers/acceptance/2026-10-25-release-migration-preflight.md`
- Update: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: 本机实际安装、ShipIt 故障注入与恢复、账号和终端摘要、实际 PTY/脚本记录。
- Produces: 如实区分人工恢复与全自动路径的验收说明，以及旧版安装超时的用户说明。

- [ ] 记录旧版暂存约 200 秒超过交接上限、已有受控恢复入口的人工介入，以及原生签名安装和数据验收结果。
- [ ] 保留已验证的失败场景；不将候选构建或模拟断言写成实机成功。
- [ ] 更新待发布说明并重新检查目标版本的完整信文；单纯补验收不重复升版，如 CI 或 Release 失败后修复则按发布流程递增版本并重新执行门禁。
- [ ] Windows 验收、最新提交 CI 和最终审查通过后，继续 Release、说明归档、TestFlight、服务端部署与站内信。
