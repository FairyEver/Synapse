# 最近两天改动的 macOS / Windows 兼容性审计

审计日期：2026-09-14。范围为 `15678574e12f7afaf741ac8c61f1956a59ec8d2a..856288724` 的 15 个提交，246 个变更文件：121 个实现/配置文件、88 个测试及夹具文件、37 个文档/证据文件。按提交时间选择最近 48 小时的改动，固定上述端点，避免后续提交改变审计范围。建立全部文件清单，对新增代码做平台敏感点扫描，并重点审查命令、路径、持久化、SDK 控制、协议路由和滚动边界；不是对全部历史代码的无缺陷证明。

结论：已修复本轮可确认的跨平台缺口，本机回归通过；Windows 原生执行仍待 CI/实机验收，不能宣布两个系统已完全等价。没有推送或触发远端 CI，没有重新执行原用户日志分析或真实百炼任务。

## 已确认问题与修复

| 问题 | 影响 | 修复与证据 |
|---|---|---|
| `quit:server` 的 `${VAR:-default}` 与前置环境变量赋值 | Windows 默认命令解释器不能按 Unix 语义运行，停止本地服务失败 | 改为 Node 调用清理脚本和 Docker，默认值通过 env 对象传递；保留退出码、信号和失败中止，测试不执行真实停止 |
| 嵌套 pnpm 直接 spawn `pnpm.cmd` | Windows 的根 `pnpm quit` 链路受 `.cmd` 启动方式影响 | 根 pnpm 提供 JS 启动器，使用当前 Node 执行（独立 pnpm.exe 直接执行）并保留原始 argv；不拼入 shell。独立运行内部脚本且缺少启动器时显式报错 |
| 任务单元先比较原始路径字符串 | 同一原件的大小写/目录别名变化被误判为替换任务材料 | 新路径须经有界 realpath 匹配已登记规范路径，再沿用原始路径；不同文件、无法证明的别名仍拒绝，不统一转小写 |
| Windows UNC / 扩展路径缺少脱敏与关联 | 共享目录可能出现在诊断文本中，且没有稳定资源关联 ID；带空格路径在手动恢复时可能只遮掉前半段 | 共用绝对路径脱敏，覆盖 UNC、扩展路径、file URL、引号/转义引号及空格；导出在脱敏前生成独立随机盐的资源 ID |
| 手动恢复将盘符相对路径当作普通相对路径 | `D:foo` 依赖每个盘符的隐藏工作目录；跨系统日志可能把 Windows 绝对路径当作工作区相对路径 | 按工作区路径格式计算相对路径，拒绝盘符相对路径、其它盘符/共享根和父目录逃逸；通过真实 `path.win32` 运算验证 |
| Windows CI 未覆盖新增 Agent 协议；夹具只覆盖 HOME | 既有 Windows job 只跑 Git/打包，新图片续接和任务证据协议未获原生验证；Windows USERPROFILE/系统启动变量不完整 | 增加 `test:agent:cross-platform` 门禁，显式提供 Git Bash；夹具隔离 HOME、USERPROFILE 和临时目录，保留必要系统启动变量 |

首次新增路径回归在修复前为 9 项失败、37 项通过，复现了缺陷；修复后该组通过。新增的 UNC 检查不通过目录枚举访问网络共享，也不读取用户凭据。

Node 的 canonical path 不是通用文件唯一标识，不能用路径统一转小写替代校验。本轮只接受 realpath 确认相同的别名，保留原有版本/范围检查；不承诺任意挂载点、硬链接或并发替换语义。[Node 文件系统说明](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback)

## 其它近期变更的检查结果

| 变更域 | 检查重点 | 本轮结果与边界 |
|---|---|---|
| 图片预算与工具正文治理 | Windows 反斜杠的 JSON 转义、CRLF、UTF-8 字节数、Base64、原生 token 快照 | 请求体使用序列化字节；视觉 token 未知不补零；200K/5 MiB/6 MiB 不变。原生中文/空格/CRLF/BOM 读取通过 |
| SDK 停止与 Router 交接 | 不使用 Unix kill 代替 SDK interrupt；旧代停止确认、迟到结果、并行图片、取消 | 维持 interrupt→close→iterator 结束的屏障；本机真实 SDK 回归通过，Windows 的原生进程控制仍待 runner |
| 检查点与持久证据 | 系统路径拼接、文件关闭后 rename、原件版本、失败回滚、SQLite 锁与事务 | 使用 Node 路径/文件 API；本机恢复、保存失败与 SQLite 双连接/锁冲突回归通过。不能由 macOS 推导 Windows 防病毒、SMB 或磁盘锁行为 |
| 长历史分页、MCP 与 IPC | 字节与字符偏移、工具 ID 关联、消息为空回退、可恢复状态 | 业务协议没有 OS 分支；受影响专项通过 |
| 深链与窗口恢复 | URL 编解码、Windows argv/second-instance 与 macOS open-url、共享路由、失效 Renderer | 新线程链接进入已有协议路由，单元/集成测试通过；Windows 安装器关联及冷/热启动尚未在实机验证 |
| 滚动与 Renderer 性能 | 鼠标滚轮单位、滚动条拖动、触摸/键盘、ResizeObserver、窗口大小变化 | 实现按滚动意图和 DOM 尺寸处理，相关 hook/组件测试通过；未运行真实 Windows 触控板、高 DPI 或多屏视觉验收 |
| 模型选择、能力注册与用量 | UI 与 MCP 共享选择、未知用量/Session 统计、来源 platform 字段 | 未发现新增 OS 依赖；这里的 conversation platform 是消息来源，不是 win32/darwin |
| 包结构 | 本轮未更改依赖、原生二进制布局或安装器配置 | 既有本机 macOS 包结构检查通过；它是先前构建产物，不是本轮源码的重新打包或 Windows 安装验收 |

## 验证记录

- 最近两天变更对应专项：85 个文件通过、1 个真实服务开关文件跳过；1479 项通过，3 项跳过。包括实际安装 SDK 0.3.245 + loopback 的两组 48 图多次续接，以及停止/取消、持久进度、分页、IPC/MCP、Renderer 和 SQLite。
- 跨平台门禁包括 14 个测试文件、160 项测试，包含在上面受影响回归中。最后增强的原生路径与导出别名用例另行通过；原生路径覆盖：中文/空格文件名、正斜杠路径、CRLF/BOM、文件系统实际支持时的大小写别名，并验证持久覆盖完成。
- Node 本地停止脚本测试：20 项通过；使用替代执行器核对参数、默认变量、显式变量、失败和退出状态，不停止正在运行的服务。
- desktop typecheck、变更 TypeScript ESLint、hard constraints、git diff 格式检查通过。CI YAML 已解析并确认 Windows 门禁存在。
- `check:packaged-asar` 验证本机既有 Synapse.app：27687 个 packed 文件、1599 个 unpacked 文件；包含既有 JSON Repair、文本提取、HTML Worker、Terminal 的检查。

复现命令：

```sh
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test:agent:cross-platform
node --test scripts/__tests__/quit-server.test.mjs scripts/__tests__/run-server-with-env.test.mjs scripts/__tests__/quit-processes.test.mjs
pnpm --filter @synapse/desktop run check:hard-constraints
```

Windows CI 在 `desktop-windows` 中先配置已有 Git Bash，之后执行同一专项，再运行原有 Git 检查、build 和 Windows 打包。macOS job 的全量测试包含这组专项，并新增停止脚本测试。CI 没有 continue-on-error，也没有将 Windows 失败自动跳过；真实百炼仍为单独显式开关，不向 CI 注入用户凭据。

## 尚未验证

1. Windows runner 尚未运行当前改动，不能填 Windows PASS；本轮只本地提交。
2. Windows 正式安装、协议注册、Renderer 崩溃恢复、高 DPI/触控板、远程共享锁、长路径和防病毒干预需真实系统验证；单元测试不能替代。
3. 根目录 `dev` / `dev:server` 原有的 Unix 并行启动写法不在这 15 个提交的新增范围，本轮没有重写整套服务启动器。修复的停止入口不等同于 Windows 全栈开发流程已经通过。

脱敏范围清单、测试状态与源码指纹见同目录 `2026-09-14-macos-windows-compatibility-audit.json`。早先百炼报告保留当时源码指纹，不覆盖或冒充本轮 Windows 验收。
