# 提示词 11：v2 Computer Use 真实桌面人工验收

把下面提示词完整发送给新的 Codex 对话。本阶段用于真实操作用户电脑上的 Synapse Electron 应用，执行 CC Connect v2 迁移后的 A-E 人工验收。

````text
请在 `/Users/liyang/Documents/code/github/Synapse` 仓库中执行 CC Connect v2 迁移后的真实桌面人工验收。

本次任务只做人工验收、缺陷记录、状态交接和文档提交。不要修改 `desktop/` 业务代码，不要继续开发新功能，不要修复缺陷。发现问题只记录，等待用户决定是否进入修复阶段。

你的角色：
你是一个严谨的发布验收负责人。你的任务不是证明功能已经完成，而是像真实用户一样操作软件，找出“按钮没反应、功能是空壳、保存不持久化、错误反馈不清楚、敏感信息泄漏、与已确认裁剪点混淆”的问题。

## 必须读取

1. `AGENTS.md`
2. `.claude/rules/design.md`
3. `.claude/rules/ui-rules.md`
4. `待办/cc-connect-migration/整体标准.md`
5. `待办/cc-connect-migration/artifacts/0.0-latest-handoff.md`
6. `待办/cc-connect-migration/artifacts/9.6-v2-pre-release-manual-acceptance-checklist.md`
7. `待办/cc-connect-migration/artifacts/9.7-v2-manual-acceptance-handoff.md`
8. `待办/cc-connect-migration/artifacts/10.1-user-skeptic-code-review.md`

## 当前已确认裁剪点

以下内容不要当成缺陷：

1. `F-004`：不迁移旧 CC Connect 的 Web Admin 登录页。
2. `F-027`：不要旧 CC Connect 的独立 Provider 推荐市场页 / 预设生态页。
3. `F-028`：不要独立 per-agent provider 预设生态入口，只保留服务商设置页内的预设辅助填表和 per-agent 配置能力。
4. `F-030`：推荐 Skills / Skills 商店首轮不做，后续结合 3S 现有技能体系处理。
5. `F-051`：Raw TOML 不做完整编辑器，只做脱敏查看 / 导入 / 必要诊断。
6. `F-058`：不复制旧 CC Connect 的 npm wrapper、daemon 管理、自更新、独立 logs/doctor 命令入口；只把必要状态、日志、安装来源、版本、doctor 检查合并到 3S 设置/诊断体系中，高风险操作默认不做或必须二次确认。

## 必须使用 Computer Use

本次必须使用 Computer Use 操作用户电脑：

1. 先用 Computer Use 查看当前屏幕状态。
2. 用户电脑上有 Windsurf 编辑器窗口，底栏有 `D`、`Bump`、`Q/Kill` 等按钮。
3. `D` 按钮用于启动开发环境，会运行 dev 流程；它可能先打开浏览器页面，随后启动 Synapse Electron 应用。
4. `Q` 或 `Kill` 按钮用于杀掉当前 Synapse 相关进程。
5. `Bump` 是用户自己的提交按钮，禁止点击。
6. 不要通过 shell 手动启动或杀进程；启动/重启优先通过用户提供的 `D` 和 `Q/Kill` 按钮完成。
7. 如果浏览器被自动打开，可以忽略或关闭；本次验收重点是 Synapse Electron 应用。
8. 如果应用白屏、卡死、无法点击或无法恢复：回到 Windsurf，点击 `Q/Kill`，等待进程结束，再点击 `D` 重启。最多重启 2 次；仍失败就记录 blocker 并停止。

## 安全规则

1. 不输入真实 API key、真实 token、真实密码、真实二维码内容。
2. 只使用测试值：

```text
测试前缀：cc-v2-acceptance
测试项目名：cc-v2-acceptance-project
测试 provider 名：cc-v2-acceptance-provider
测试 API key：sk-test-cc-v2-acceptance-123456
测试 token：test-token-cc-v2-acceptance-123456
测试 Base URL：https://example.com
测试模型：test-model
```

3. 不删除用户已有数据。只允许删除本次创建且名称以 `cc-v2-acceptance` 开头的测试数据。
4. 如果遇到系统权限、真实登录、真实 token、真实二维码、危险操作确认、删除非测试数据，必须暂停并通知用户。
5. 不启动 Playwright、Chrome DevTools、浏览器自动化；本阶段以 Computer Use 桌面操作为准。
6. 不修改业务代码。只允许写入 artifacts 验收报告、缺陷清单、状态交接文件。

## 状态文件

开始后立即创建或更新：

```text
待办/cc-connect-migration/artifacts/11.0-computer-use-manual-acceptance-state.md
```

每完成一个大段 A/B/C/D/E，都要更新这个 state 文件，记录：

```text
当前段落：
已完成步骤：
通过：
失败：
阻塞：
风险：
是否重启过应用：
下一步：
```

如果会话中断，下一次恢复时必须先读这个 state 文件继续，不要从头重复。

## 验收步骤

按 `9.6-v2-pre-release-manual-acceptance-checklist.md` 执行 A-E。每个步骤都要记录 `pass / fail / blocked / risk / not_applicable`。

### A. 项目和连接

1. 打开 3S。
2. 进入连接。
3. 查看运行概览，确认项目数、平台数、最近会话不是硬编码。
4. 新建项目，名称使用 `cc-v2-acceptance-project`，workdir 选择一个本地存在的普通目录，agent 类型选择界面中可用项。
5. 保存后确认项目列表出现该项目。
6. 进入项目详情。
7. 打开添加平台。
8. 选择 QR 平台，确认是等待/draft/错误/二维码/设置流程中的哪一种，不要扫描真实二维码。
9. 选择手动 token 平台，填 `test-token-cc-v2-acceptance-123456`，保存后检查 token 是否明文显示。

### B. Provider

1. 进入设置 > 服务商。
2. 新增 provider。
3. 填写 `cc-v2-acceptance-provider`、`https://example.com`、`test-model`、`sk-test-cc-v2-acceptance-123456`。
4. 保存后检查列表是否出现 provider。
5. 检查 API key 是否脱敏或仅显示 secretRef，不允许明文泄漏。
6. 回到连接 > 测试项目 > 服务商，尝试绑定全局 provider。
7. 新增项目自定义 provider。
8. 打开 CC-Switch 导入预览，确认是否有预览、冲突、错误反馈；不需要导入真实配置。

### C. 会话和命令

1. 进入会话。
2. 选择测试项目或创建测试会话。
3. 打开历史 session 抽屉。
4. 新建会话。
5. 输入 `hello cc v2 acceptance` 并发送。
6. 记录结果：真实发送、明确错误、`runtime not connected`、按钮无反应、还是假成功。
7. 查看 thinking/tool/permission/error 等富消息区域是否存在真实反馈。
8. 打开命令面板并搜索 `status`。
9. 执行安全命令，记录结果。
10. 执行 `/skills`，确认是否指向 `技能 > 项目扫描`。

### D. 自动化

1. 进入自动化。
2. 新建 Prompt Cron。
3. 选择测试项目，填写 schedule、prompt、session key、权限模式。
4. 保存后确认任务列表出现。
5. 测试启停任务。
6. 编辑任务。
7. 删除本次测试任务。
8. 新建 Exec Cron，确认出现权限/风险提示。
9. 切换 Heartbeat，配置测试项目 heartbeat。
10. 切换 Hooks，新增 HTTP hook 或 command hook。
11. 查看最近运行或状态反馈。

### E. 系统设置和诊断

1. 进入设置 > CC Connect。
2. 修改一个无风险配置，例如 preview、rate limit、log level 中的可用项。
3. 保存后刷新/切换页面再回来，确认值是否持久化。
4. 查看脱敏 Raw TOML，确认没有 `sk-test-cc-v2-acceptance-123456` 或 `test-token-cc-v2-acceptance-123456` 明文。
5. 尝试 reload，确认有操作反馈。
6. 尝试 restart，确认有明确确认提示；不要无确认地执行高风险操作。
7. 查看 Bridge / Webhook / Local API / Management API 诊断。
8. 查看 daemon / logs / doctor / update / install-source 诊断。
9. 查看是否有日志导出入口。

## 缺陷判定

以下情况必须记录为缺陷：

1. 按钮点击无反应，且没有 disabled 解释。
2. 表单保存后没有任何反馈。
3. 列表显示假数据、硬编码数据，且没有说明是空态或示例。
4. 保存成功后刷新丢失。
5. API key/token 明文出现在列表、Raw TOML、日志、通知或普通 UI 中。
6. 高风险操作不经确认就执行。
7. UI 显示“成功”，但实际没有任何保存、执行或明确错误。
8. 文案暗示真实 runtime 已接通，但实际只是 draft、diagnostic-only 或 `runtime not connected`。
9. 已确认裁剪点之外的 CC Connect 核心功能缺失。

以下情况优先记录为风险，而不是缺陷：

1. Chat 返回 `agent runtime is not connected`，但 UI 有明确错误反馈。
2. QR 平台只保存 draft，但界面没有宣称扫码已完成。
3. Bridge/Webhook/API/daemon 只显示诊断，不提供旧 daemon/API 控制面。
4. Skills 商店/Provider 生态页不存在，因为用户已确认不做。

## 输出文件

必须生成或更新：

```text
待办/cc-connect-migration/artifacts/11.0-computer-use-manual-acceptance-state.md
待办/cc-connect-migration/artifacts/11.1-computer-use-manual-acceptance-report.md
待办/cc-connect-migration/artifacts/11.2-computer-use-manual-acceptance-defects.md
待办/cc-connect-migration/artifacts/0.0-latest-handoff.md
```

`11.1` 报告必须包含：

```text
# 11.1 Computer Use 人工验收报告

## 总结结论
pass / pass_with_risks / incomplete / blocked

## 环境和启动方式

## A-E 验收结果总览
表格：段落、通过数、失败数、阻塞数、风险数、结论。

## 逐步验收记录
按 A/B/C/D/E 记录每一步看到的界面、点击、输入、实际结果、结论。

## 缺陷清单摘要

## 风险清单摘要

## 是否发现敏感信息明文泄漏

## 是否发现高风险操作绕过确认

## 是否发现空壳入口

## 是否需要进入修复阶段
```

`11.2` 缺陷文件必须使用格式：

```text
ID:
验收段落:
步骤:
状态: fail / blocked / risk
期望:
实际:
证据:
是否属于已确认裁剪点:
是否阻塞发布候选:
建议下一步:
```

## 验证和提交

测试结束后运行：

```text
git status --short
git diff --check
```

如果只修改 artifacts 文档，提交一次 commit：

```text
stage11(manual-acceptance): 记录 Computer Use 人工验收结果
```

不要提交业务代码修改，因为本阶段禁止改业务代码。

## Bark 通知

以下情况必须发送 Bark：

1. 测试完成。
2. 测试阻塞。
3. 应用连续两次无法启动。
4. 发现敏感信息明文泄漏。
5. 发现高风险操作绕过确认。
6. 需要用户提供权限、真实 token、真实二维码或危险操作确认。

使用：

```text
curl -fsS --max-time 8 --get 'https://api.day.app/B3H8T6rF2p5Mj6z6oha82K/Synapse%20Computer%20Use%20%E4%BA%BA%E5%B7%A5%E9%AA%8C%E6%94%B6/%E6%A1%8C%E9%9D%A2%E7%9C%9F%E5%AE%9E%E9%AA%8C%E6%94%B6%E5%B7%B2%E5%AE%8C%E6%88%90%E6%88%96%E5%B7%B2%E9%98%BB%E5%A1%9E%EF%BC%8C%E8%AF%B7%E5%9B%9E%E5%88%B0%20Codex%20%E6%9F%A5%E7%9C%8B%2011.1%20%E5%92%8C%2011.2%20%E6%8A%A5%E5%91%8A%E3%80%82' >/dev/null || true
```

通知内容不得包含 API key、token、二维码、Raw TOML 或敏感路径细节。

## 最终回复

最终回复只需要说明：

1. 是否完成 A-E。
2. 总结结论：`pass / pass_with_risks / incomplete / blocked`。
3. 报告文件和缺陷文件路径。
4. 是否提交成功，提交 hash 是什么。
5. 是否发送 Bark。
6. 下一步是否需要修复阶段。
````
