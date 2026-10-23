# 桌面 Electron 安全升级与验收记录

## 决策与边界

分阶段采用官方 Electron **44.9.3**（Chromium **152.0.7977.167**、Node **24.22.0**），最低 macOS **13**，继续提供 Windows x64 构建。当前仅交付本地候选与验证，不推送、不发布、不替换正在使用的安装包，不包含 iOS、API 或 PDF 部署。

Electron 将 Node 的 Brotli 链接到 Chromium：

- [构建链接证据](https://github.com/electron/electron/blob/v44.9.3/patches/node/build_add_gn_build_files.patch)
- [Chromium 解码器中的非法 block-switch 修复](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/brotli/dec/decode.c#L1112)
- [上游 Brotli 修复](https://github.com/google/brotli/commit/0ed4268a4401abcb44720963)
- [Electron eMudhra 证书修复公告](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9)

因此 Node 24.22.0 这个字符串不能单独证明该 Electron 的 Brotli 未修复，也不能据此宣称其包含全部 Node 24.22.1 修复。服务端的 Node 门禁保持独立。

## 产物与更新门禁

`electron-security-baseline.json` 保存官方 macOS arm64 / Windows x64 ZIP 的 URL、SHA256 和原生代码 section 指纹。下载由 Electron 官方下载器校验 SHASUMS256.txt，本次另行比对的 ZIP SHA256：

| 目标 | 官方 ZIP SHA256 |
|---|---|
| darwin-arm64 | `4af51382278d00291dfcda265eddd9bab6e98cebb09f46aadc8438bf606de162` |
| win32-x64 | `41a1ffa0541cb0f2c9b9fe920dd2cef1793ad0ea2ada1a9582958880f4d1b23c` |

完整候选包通过 `check:packaged-asar`（默认无条件要求主程序存在；仅显式 `--resources-only` 允许结构片段）检查其自身运行时、指纹和网络探针；macOS 比较 Framework 的 `__TEXT,__text`，Windows 比较可执行文件的 `.text`，避开产品资源与签名变化。指纹证明受审查原生代码的一致性，不证明整个应用 bundle 的来源；整体签名、公证仍独立验收。运行探针只在 `ELECTRON_RUN_AS_NODE=1` 独立进程执行，不加载 Synapse 主入口。版本变化必须重新核查官方来源与安全补丁，不能自动放行未知大版本。

安装包 `mac.minimumSystemVersion=13.0.0`；`package-mac-compiled.mjs` 在 builder build() 完全结束后对 macOS 安装产物写入 `latest-mac.yml minimumSystemVersion=22.0.0`。发布准备在改写或清理输出前拒绝缺失、格式错误或错误数值；Windows 元数据不添加此限制。旧版 1.0.79 的 electron-updater 6.8.3 已支持该字段，比较 `os.release()`，因此 macOS 12 / Darwin 21 被拒绝，Darwin 22+ 被接受。

保留 ShipIt 运行状态/PID 确认、超时回滚、保留主窗口与后台恢复全部不变量。上一版本制品、源版本和更新元数据保留；候选写入独立 release 子目录。投放失败时停止新版更新流；若需回退兼容改动，须同时保留安全修复或明确记录仍暴露的风险，不能默默退回旧内核。

## Electron 44 必需的剪贴板兼容

原生文本读写变为 Promise，图片与原始格式改由 ClipboardItem Blob 读取。工作流等待原生调用完成再返回和审计；异步拒绝仍映射原有错误。终端保持文本优先、图片大小与私有文件限制；Agent 附件仍走原有暂存服务。手机同步读取两个既有敏感 OS 标记对应的 `electron application/osclipboard;format="..."` 字节，不使用旧版 `has(UTI)`；探测失败、停止后的结果、旧轮次结果或读取期间变化的文本均不采集。IPC、MCP、Workflow schema 和能力数量不变。

原始格式的依据为 [Electron 44 原生格式枚举](https://github.com/electron/electron/blob/v44.9.3/shell/browser/api/electron_api_clipboard.cc#L123)；不将旧版 availableFormats 的缺陷结论套用于新 API。

## 第二阶段风险矩阵

依据 [Node 2026-10-21 公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。下表不将静态路径检查当成漏洞未受影响的证明。

| 项目 | 本阶段结论与入口 | 后续门槛 |
|---|---|---|
| CVE-2026-111497 / Brotli | Chromium 修复源码与官方候选代码一致；主进程 fetch、MCP、工作流与脚本均使用新内核。正常、分块和无效输入探针通过；未执行 RCE 利用载荷。 | 后续版本继续核对实际解码器来源。 |
| eMudhra 受损证书 | 44.9.3 高于 Electron 公告要求的 44.9.1；覆盖 Chromium 和 Node TLS/HTTPS/fetch。 | 保持官方证书修复，不关闭证书校验。 |
| CVE-2026-105482 / DNS NUL | Node 24 适用；源码未发现业务直接使用 dns.resolve/reverse，第三方 SDK 的可达性尚未完整排除。 | 纳入官方 Node 更新或取得等效修复证据。 |
| CVE-2026-105483、106069、106072 / TLS 主机名 | **仍有风险**。候选 `tls.checkServerIdentity` 对 `127.1`、全角 `１２７.0.0.1` 与仅 DNS:127.0.0.1 的模拟证书均返回接受。此为纯函数验证，不等于已完成网络攻击复现。自定义 IMAP/SMTP 和其它 Node TLS 调用须纳入后续验证；邮箱 ASCII host 校验不能覆盖全部非规范 IP。 | 发布说明不得写“修复全部 TLS 漏洞”；后续稳定版纳入 Node 24.22.1 或逐项等效修复。 |
| CVE-2026-105481 / HTTP Agent | Node 24 适用；原生 HTTPS 与 SDK 可使用 Agent，未确认本候选包含补丁。 | 官方或等效补丁，加连接复用异常响应回归。 |
| CVE-2026-106074 / entropy snapshot | 未发现项目自建 Node --build-snapshot 或 SEA useSnapshot 路径；不将这点扩展为所有第三方运行时均安全。 | 更新内核，并检查后续自定义快照构建。 |
| CVE-2026-106070、106071 | 公告仅影响 Node 26，本候选 Node 24 不适用。 | Node 主版本变更时重评。 |
| CVE-2026-106073 / realpathSync 权限 | 项目使用 PermissionGuard；受控脚本入口未启用 Node --permission，不存在当前声明的 Node 权限沙箱保证。内核补丁仍未确认。 | 后续内核补丁；不能依靠未修复的 Node 权限模型新增沙箱承诺。 |
| c-ares / Undici / OpenSSL 等依赖 | Electron 有自有依赖与 BoringSSL 组合；不能从服务端 Node 公告直接推断全部已修复。 | 随后续官方 Electron 修复整体核对。 |

第一阶段只是已明确授权的 Brotli、证书和维护线迁移，不是所有高危项清零。第二阶段由下一次桌面安全升级继续处理，门槛是受支持稳定版包含 Node 24.22.1 或逐项等效补丁并通过回归；不自动切换到预发布版或自编译运行时。

## 验证与发布前待办

- 安全基线单测覆盖版本冒充、代码指纹不匹配、探针失败、非法二进制与签名资源变化。
- 实际候选探针覆盖普通/分块 Brotli、gzip/deflate、无效输入、传输截断、重定向、取消与超时；单改 Accept-Encoding 仍会收到并解压 br，不能作为修复。
- 剪贴板专项覆盖 Promise 完成、图片粘贴、敏感格式失败、停止和轮次隔离；保留所有更新交接与恢复测试。
- 本机 macOS 验证不能替代 Windows x64 实机启动、PTY、脚本与更新验收。
- **正式发布门槛**：签名、公证、完整包结构与实际候选运行时检查；真实 1.0.79 → 更高应用版本的更新、ShipIt 失败场景、登录凭据与终端数据读取。当前候选不执行版本 bump、不覆盖 /Applications，不能把同版本本地构建记为真实跨版本更新成功。

实施后的具体命令、结果和未通过项在本节下补充，不以计划代替验收。

### 2026-10-24 本地验证

- `pnpm --filter @synapse/desktop run typecheck`、`check:hard-constraints` 通过；本次 TypeScript 文件的 ESLint 与 `git diff --check` 通过。现有 ESLint 配置忽略 release/checks 脚本，不将其记作已通过脚本 lint。
- 聚焦回归 188/188 通过，覆盖网络、MCP、工作流、剪贴板、终端、脚本、加密存储、更新交接与发布元数据；审查修复的 ASAR/剪贴板专项 48/48 通过。原生指纹与打包顺序的 Node 测试 8/8 通过，并接入正常 Vitest 入口；该入口与 package scripts 检查 5/5 通过。
- 全量 `vitest run --maxWorkers=4`：1,071 个文件，10,841 通过、7 失败。未通过项为 MCP 顶层组合 schema（1）、工具中文/分词搜索（2）、bootstrap 服务依赖清单断言（2）、Agent 共享上下文指示器（2）。这些失败断言对应本次未修改的行为；当前工作区还包含任务开始前已有的工具路由/命名改动，不将本次结果记为全量通过，也不顺带修改这些模块。
- `check:terminal-runtime` 在 Electron 44 中通过实际 PTY 加载、输出、输入排队、resize/stop 与 raw buffer；`check:script-runtime:runtime-smoke:built` 通过。终端检查的 safeStorage 为 `deferred_app_ready_unavailable`，不等价于真实用户登录凭据迁移验收。
- Electron 44 的 ABI 为 149；现有 `@electron/rebuild` 间接依赖 node-abi 4.28 无法识别，故仅覆盖其 node-abi 为 4.39.0。node-pty 已重建成功。官方头文件下载曾连接重置，本地下载使用镜像后逐字节核对官方 SHASUM；未将镜像或本机头文件路径写入项目配置。
- 候选保持应用版本 **1.0.79**，目录 `desktop/release/electron44-security-candidate/`。候选 ASAR 检查已验证 49,953 个打包文件、1,640 个解包文件，并通过候选自身版本、官方原生代码指纹、Brotli/gzip/deflate、重定向、截断、取消、超时探针。最终签名/公证结果及打包后复检另行记录如下。
- 完整 macOS arm64 DMG/ZIP 构建完成；`codesign --verify --deep --strict` 通过。签名后再次运行候选目录的 `verify-packaged-asar.mjs` 与 `verify-packaged-script-runtime.mjs`，均通过；`latest-mac.yml` 实际包含 `minimumSystemVersion: 22.0.0`，应用 Info.plist 为 `13.0.0`。
- 本地 release 环境未配置 builder 的 Apple 公证变量，构建器明确记录跳过公证。随后使用项目已有的 Apple API 凭据单独提交候选 DMG；此操作不执行 iOS 上传或任何桌面发布。公证最终状态以以下实际记录为准，不能用签名成功代替。
- Apple 公证提交 `ff26018e-cc0b-466c-a356-58a19ce1bbbb` 最终为 **Accepted**。应用与 DMG 均完成 `stapler staple/validate`；应用的 `spctl --assess --type execute` 返回 **accepted / Notarized Developer ID**，附加票据后再次通过严格签名校验。ZIP 从带票据的已签名应用重新归档，并逐字节比对其 `Contents/CodeResources` 公证票据；DMG 附加票据后重建 blockmap，重新计算两个产物的大小和 SHA512、恢复 Darwin 最低系统字段，再运行实际发布准备校验，全部通过。仅生成本地文件，没有上传 CDN 或改写正式更新源。

| 本地最终候选 | 大小（字节） | SHA256 |
|---|---:|---|
| `Synapse-1.0.79-mac-arm64.dmg` | 322599536 | `902d0a27133bd5819a914fe72c91f1a9439d733afceb6cd0ba209a82215bb7c8` |
| `Synapse-1.0.79-mac-arm64.zip` | 311838902 | `c57790eec26bf177062c84d06701fae966f3a47ea7576c1f19fe18614c371d47` |

仍未完成 Windows x64 实机验收、真实 1.0.79 → 更高版本更新，以及真实账号凭据/终端数据迁移验收。本次同版本候选不能向现有用户投放；全量测试的 7 项失败与第二阶段 Node 风险也仍需在后续交付中如实保留。
