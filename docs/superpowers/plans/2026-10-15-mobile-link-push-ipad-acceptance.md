# 链接推送收尾：iPad 终端导航回归验收

日期：2026-10-15。对应 [实施计划 Task 8](2026-10-15-mobile-link-push.md) 的最后一条 UI 验证。

## 最终对照

先在独立的 `/tmp/ipad-baseline` worktree 构建 `4eaf1bf8d`，再验证当前产品源码 `123d52c64`；主工作区未切分支或 HEAD。两边使用各自的 Derived Data、相同的真实认证 relay、生产文件适配器及只读验收夹具。文件适配器两跳 smoke 为 15/15 通过。

最终在同一台 iPad Pro 13-inch (M4)、iPadOS 18.6（`7B5EEC32-207A-4AEA-9CF1-9CE3AF70ED9A`）上，按基线 → 当前版顺序运行：

| 源码 | WorkspaceFilesUITests 方法 | 实际执行 / 通过 / 失败 / 跳过 | 耗时 | xcresult |
| --- | --- | --- | --- | --- |
| `4eaf1bf8d` | `testWideTerminalKeepsItsOwnTitleAndStatusBeforeAnyResourcePresentation` | 1 / 1 / 0 / 0 | 23.011 秒 | `/tmp/synapse-link-followups-baseline-18.xcresult` |
| `123d52c64` | `testWideTerminalKeepsItsOwnTitleAndStatusInSplitView` | 1 / 1 / 0 / 0 | 20.536 秒 | `/tmp/synapse-link-followups-head-18.xcresult` |

两次进程均 exit 0；同时核对日志的 `Executed 1 test` 与 `xcresulttool get test-results summary` 中的实际方法结果及计数，未将空选择器或跳过算作通过。

用例实际通过了横屏宽布局的会话标题与 `terminal-second-line` 状态可达性、附件菜单的工作区文件入口、面板关闭及关闭后的标题与状态断言。此次不修改产品代码或测试断言。该删除的最后一个未执行断言已在 iPadOS 18.6 关闭；不外推为系统半窗、窗口伸缩或全套无障碍验收。

## 运行方式

使用 Xcode 26.5 SDK。先按交接说明执行 `build-for-testing` / `CODE_SIGNING_ALLOWED=NO`，随后用同一构建目录、`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-` 增量构建，生成可使用模拟器 Keychain 的本地签名与 entitlement。单纯对无签名产物补 `codesign --deep --sign -` 不足以完成登录。

账号由仓库验收脚本准备，凭据从权限为 0600 的本机文件读取到私有 xctestrun 的测试进程环境中，不写进仓库或命令参数。调用形式为：

```bash
xcodebuild test-without-building -xctestrun <各自的私有 xctestrun> \
  -destination 'platform=iOS Simulator,id=7B5EEC32-207A-4AEA-9CF1-9CE3AF70ED9A' \
  -parallel-testing-enabled NO -resultBundlePath <独立 xcresult> \
  -only-testing:SynapseMobileUITests/WorkspaceFilesUITests/<该版本实际方法名>
```

最终日志分别为 `/tmp/synapse-link-followups-baseline-18-test.log`、`/tmp/synapse-link-followups-head-18-test.log`。模拟器运行后均执行 `simctl shutdown`，并核对没有本次遗留的 booted 设备。

## 保留的失败与证据边界

此前在 iPad Pro 13-inch (M5)、iPadOS 26.5 上的运行也全部保留，不以最终通过覆盖失败：

| xcresult（均在 `/tmp/`） | 结果 |
| --- | --- |
| `synapse-link-followups-baseline.xcresult` | 实际执行 1 条，登录前置失败；日志确认 Keychain 缺 entitlement（`-34018`），尚未到目标断言。 |
| `synapse-link-followups-baseline-signed.xcresult` | 实际执行 1 条，登录后“终端 tab 必须可达”的前置断言失败，尚未到目标断言。 |
| `synapse-link-followups-head-26.xcresult` | 实际执行 1 条，完整通过，0 失败 / 0 跳过。 |
| `synapse-link-followups-baseline-26-final.xcresult` | 实际执行 1 条，完整通过，0 失败 / 0 跳过。 |
| `synapse-link-followups-head-26-final.xcresult` | 实际执行 1 条，标题和状态通过；后续 `files-close` 等待超时。失败时 AX 层级仍显示附件菜单和“工作区文件”，未进入文件面板；不能声明该系统稳定全绿。 |
| `synapse-link-followups-baseline-repeat.xcresult` | runner 因模拟器 `Busy` 无法启动，未实际进入目标用例。即使 summary 包含 runner 失败计数，也不算有效业务用例执行。 |

26.5 的附件点按波动没有在本任务定因或修改。指定回归断言的闭环依据是上方 18.6 上同机、按顺序、两侧完整通过的真实结果；不是整套测试的退出码，也不是只编译成功。
