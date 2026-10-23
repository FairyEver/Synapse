# 本机邮箱客户端验收与交接

对应设计：`docs/superpowers/specs/2026-10-23-mail-client-design.md`；前置迁移计划与邮箱实施计划均为2026-10-23版本。当前工作在原仓库 main 顺序实施，没有推送、部署或启动应用。

## 当前状态

| 层次 | 结果 | 证据 / 边界 |
| --- | --- | --- |
| 站内信命名迁移 | 自动回归通过 | 原始配置幂等迁移；桌面、服务端、共享通知和 iOS 引用改名；没有旧入口别名 |
| 新邮箱核心与 UI mock | 通过，最终计数见下方 | 本机索引、草稿、MIME、发送、Sent、通知、身份隔离、公开 MCP 和私有 IPC |
| 真实阿里账号 | 待验 | 之前独立邮件实验不是新客户端验收 |
| 桌面视觉、键盘和 OS 通知 | 真实应用待验 | JSDOM 行为和组件测试通过不能证明视觉或原生权限 |
| macOS 候选包 | 最终构建、ASAR与依赖闭包通过 | ad-hoc本机签名、未公证，非生产发布或真实运行验收 |
| Windows 候选包 | 待验 | 当前 macOS 环境不外推 Windows 结果 |
| 生产迁移 | 待验 | 未访问或写入真实业务库；SQL UPDATE 通过隔离 fixture，生产 PostgreSQL 需发布前预检 |

代码和自动化检查完成后，仍不能把上述真实验收项目标成整体已交付。项目规则要求明确授权才启动应用或浏览器；本次仅构建，不启动。真实邮件写操作必须使用本次验收明确同意的测试收件人、邮件和独立文件夹，不沿用此前实验作为长期授权。

## 自动化证据

- R1–R4：旧配置、Dock / 备份恢复、站内信 MCP / HTTP、通知 source 和幂等 SQL fixture 已通过对应阶段测试。iOS 链接纯 Swift 检查16例通过；`build-for-testing` 成功，仅构建测试目标，没有运行模拟器或真机测试。
- C1–C13：邮箱核心与 UI / 内部信件回归127项通过；完整 desktop typecheck、IPC codegen、hard constraints、UI tracking 通过。
- C14：完整 mock 流程包含后台基线→IDLE新信→本机提醒→搜索完成事件→UI/MCP并发草稿CAS→MIME发送→Sent内容核验→服务重建读取回执。SMTP只提交一次，Sent不重复APPEND，无云通知请求，备份无mail命名空间。
- C14 安全回归：跨邮件图片在下载前拒绝；暂停使进行中的图片读取失效；切换身份关闭原生通知；同一 SY 用户重新登录也更新 UI generation。44份 Skill 输入定义逐项与实际工具schema比对。异常/过深MIME和超大/无效地址邮件头单封降级，后续索引继续；不完整地址不能自动构造回复。
- 当前全局340个 capability、336个 MCP 索引；公开 tools/list 仍只有 search / invoke。邮箱44项，站内信17项。22个桌面 System App，邮箱不默认固定 Dock；外部邮箱不进入手机。

桌面扩大回归52个文件285项通过，服务端5个文件70项通过；最终完整desktop typecheck通过（包含renderer、Electron、preload和测试），主进程及renderer候选构建通过。IPC codegen、hard constraints和UI tracking通过。候选包的最终核对与包体信息见下方。所有测试数据为虚构邮箱或临时本机 fixture，没有新实现的真实收发凭据和个人邮件内容。

## 独立审阅

最终整段审阅确认7项问题，并以失败回归集中修复：永久删除限回收站、离开应用先保存、正文扫描批次不跳过余文、SMTP取消关闭实际连接、prepared发送沿用持久MIME、显示名引号与逗号往返、失效邮件的缓存附件拒绝导出。真实邮件附件的旧assetId失效不清除已固定的草稿或发送字节；发送编译使用其已保留资产。审阅未延期小项；上述真实账号、原生应用、Windows与生产迁移边界继续待验。修复后52个文件285项桌面回归通过，完整desktop typecheck通过，IPC codegen、hard constraints和UI tracking通过；候选包仍按下方实际结果区分。

## 真实阿里验收步骤

每项记录日期、操作者、候选包版本和结果，附本机日志中的固定诊断码或脱敏证据；不得附密码、授权码、原始邮件正文或收件人隐私。

| 项目 | 操作与通过条件 | 结果 |
| --- | --- | --- |
| 接入 | 在本机向导选择阿里，只输入必要信息；IMAP / SMTP 检查独立显示，连接检查不发信，密码提交后清空 | 待验 |
| 文件夹与索引 | 收件箱、已发送、草稿、垃圾、回收站、普通文件夹可导航；比对 SELECT、UID枚举和本机计数，保留服务器历史可见性未知状态 | 待验 |
| 阅读 | encoded words、多语言、正文、附件和大邮件；MCP读取不已读，UI选择明确设已读，远程图片默认无请求 | 待验 |
| 搜索 | 标题/地址/正文结果与范围准确；大邮箱每批可取消、续查，零命中不声称完整；旧搜索不覆盖新搜索 | 待验 |
| 新邮件 | 向本次明确授权的收件人发送带 To/Cc/Bcc 的测试信；核对 Bcc 不出 SMTP MIME、接收端实际内容，SMTP accepted 与实际送达分开记录 | 待验 |
| 回复与转发 | 对本次同意的测试邮件回复 / 回复全部 / 两种转发模式；核对 Reply-To、排除自身别名、引用头、原附件和CID | 待验 |
| 附件 | 上传和下载已知fixture，SHA-256一致；输出已有文件不可覆盖，超限清楚失败，粘贴图片可预览 | 待验 |
| 移动与删除 | 只用独立测试文件夹与测试信；验证阿里COPY移动不追加删除，准确UID永久删除不影响其他信；结束后只清理本次测试对象 | 待验 |
| 草稿 | 手动保存、关闭保存/放弃/取消、保存后离线/本机重启恢复、远端改稿冲突和APPEND未知都保留内容；发送成功变只读，不盲目追加远端副本 | 待验 |
| Sent | 每次发送仅一份Sent，操作回执与内容指纹一致；暂时无副本不重发SMTP，partial / unknown不自动重试 | 待验 |
| 持续后台 | 持续IDLE、断网重连、系统休眠/唤醒；关闭邮箱面板继续收信，退出SY停止；历史基线不通知、重连不重复 | 待验 |
| 通知权限 | 系统允许/拒绝分别验证；仅本机提醒，账号消息中心及手机无邮件通知；点击重新校验当前身份和定位 | 待验 |
| 深链 | 冷启动和已开窗口的synapse://mail/em_<uuid>准确定位；无效/越权目标不聚焦；mail-internal独立可用，旧mail内部ID拒绝 | 待验 |
| 身份与移除 | SY切换和同用户重新登录使旧异步结果失效；暂停关闭连接；移除审阅草稿/未知操作，保留服务器邮件，备份无mail数据 | 待验 |
| 桌面交互 | 三栏、窄桌面返回、键盘Tab/焦点返回、深浅主题、独立写信保存失败保留窗口、加载中可关闭；新建/回复/全部回复/转发及草稿窗口复用，等高搜索工具栏和整行选中背景 | 待验 |

## 升级与回滚

服务端、桌面、管理后台和手机站内信标识必须同批切换，步骤见 `mail-internal-cutover.md`。生产迁移前备份数据库、配置与附件，并预检 PostgreSQL 的实际字段值和 UPDATE 影响行数；不要删除旧存储实体、信件ID或附件key。

邮箱数据只在 `app.mail.*` 本机命名空间、加密凭据和 `userData/mail-assets`。迁移后的站内信链接使用 mail-internal，外部邮箱使用mail；不得让旧版本把已迁移配置中的mail误读为站内信。回退需协调恢复客户端配置版本和服务端领域字段，不添加旧别名掩盖混用。

故障时先暂停邮箱后台服务，保留本机数据库和受控资产。不要清理草稿、预览或提交结果不明的发送内容；unknown 先按原 operationId / clientRequestId 核验，不自动重发。移除本机账号需要明确接受未发草稿与未知操作影响，永不删除服务器邮件。

## 构建与依赖检查

固定依赖：ImapFlow2.9.1、Nodemailer10.2.1、MailParser3.12.4、DOMPurify3.4.17；Tiptap六包统一3.32.0（react/core/pm/starter-kit/extension-image/extension-text-style）。Tiptap所需Link/Underline已由StarterKit提供，测试确认不重复注册。ImapFlow/MailParser及Tiptap使用MIT，Nodemailer使用MIT-0，DOMPurify为MPL-2.0或Apache-2.0双许可；未新增协作、云编辑或付费服务。

候选包基于当前共享工作区构建，保留了任务开始前已有的两份 router / naming 未提交修改；它们没有纳入本次提交，候选不是纯净发布构建。候选输出为 `desktop/release/mail-client-candidate/`，构建命令为 `pnpm --filter @synapse/desktop run build`，并使用 `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @synapse/desktop run package:mac:compiled --config.directories.output=release/mail-client-candidate` 打包。不改版本、不发布；electron-builder回退ad-hoc签名并跳过公证。警告中缺失的是其他平台的可选WeCom/Claude SDK二进制，不能据此声称Windows验证通过。

最终候选ASAR检查通过：53724个packed、1640个unpacked文件，含既有JSON Repair、文本提取、HTML Worker和Terminal smoke。实际协议闭包45个包，提取922个文件约8.05MB；实际包中进行ImapFlow与SMTPConnection构造、Nodemailer仅内存MIME生成和MailParser UTF-8往返，未连接网络。生产账号的IMAP/SMTP行为仍待验。

Vite实际构建图8072个模块、preload esbuild图4个模块，均未包含imapflow/nodemailer/mailparser或mail/main。相对任务开始前既有本地构建缓存，renderer JS由9527007增至10051132字节（+524125，约512KiB），preload由109626增至116623字节（+6997）；这不是同commit控制组，不能将全部差值归因于单项依赖。最终ASAR为440667850字节，DMG为309546897字节，ZIP为299484784字节。

持续运行的维护每分钟处理有界预览和资产批次，预览过期释放自己的引用；不释放草稿或发送作业持有的引用。测试推进11分钟而不重启服务，确认过期预览不再长期占用资产。

HTML与粘贴内容先解析到inert template的独立owner document，再进行DOMPurify原位清洗；白名单资源替换后才供阅读或编辑器使用。回归测试拦截DOMParser输入，确认不会把带远程图片/iframe的原文交给它；这不替代真实应用的网络与视觉验收。

默认 `pnpm --filter @synapse/desktop run check:packaged-asar` 会扫描整个release目录，本机旧 `release/mac-arm64` 与当前源码产生大量hash mismatch，该全集命令未通过。没有删除历史产物或放宽校验；本次候选必须以同一脚本单独验证 `release/mail-client-candidate`，结果与默认全集扫描分开记录。

全部实施取舍见 `mail-client-decisions.md`。本记录优先说明实际结果，未通过的历史产物全集检查和真实验收待办不会改写为通过。

## 2026-10-23 邮箱体验调整验收增量

- 当前交互覆盖历史“离开应用先保存”的约定：写信独立窗口、仅显式保存/发送前落盘，关闭未保存内容走保存/放弃/取消。原有 52 文件/285 例为当时历史结果。
- 新回归覆盖不自动保存、原生关闭取消/放弃、保存失败保留、关闭加载后迟到响应、首次保存与附件导入并发、草稿窗口别名复用、未保存附件租约与过期维护、可信正文排版清洗。
- 本次没有启动 Electron 或进行真实账号发信；原生窗口外观、系统关闭事件实际表现、深浅主题和截图对照仍需运行中验收，不能用单元测试代替。

本次最终自动验证：41 个测试文件、208 项通过；完整 desktop typecheck、IPC codegen、hard constraints 和 UI tracking coverage 均通过。独立审阅指出的首次保存导入竞态、窗口草稿定位及租约维护问题已由失败回归修复并复审。
