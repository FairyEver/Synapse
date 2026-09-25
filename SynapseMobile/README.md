# Synapse Remote (iOS)

用同一个 Synapse 账号在 iPhone 或 iPad 上查看和控制电脑上的终端。

iPadOS 的可缩放窗口使用系统自适应标签栏和列表 / 详情分栏；窗口变窄时自动折叠为单列。移动端新页面的布局要求见[移动端布局规则](../docs/agents/mobile-adaptive-layout.md)。

## 导航结构

底栏三格，**不再增加**：

| 位置 | 放什么 |
|---|---|
| 主页 | 待处理会话、通知铃铛、功能清单（录音 / 云盘 / 新建会话 / 剪贴板历史） |
| 终端 | 电脑切换、会话列表、终端画布（进入后隐藏底栏） |
| 我的 | 七个分类，点进去才是设置 |

新能力一律进「主页 → 功能」，不为它开第四个槽位。通知是主页右上角铃铛打开的覆盖面板，
不是一格 tab；通知详情页已取消，正文进到行里，点一条直接去往目标。

主屏幕提供三种终端组件：小组件看待处理会话，中组件监看选定会话（最近输出需在组件设置中开启），大组件看当前电脑的会话概览。组件读取 App Group 中的只读摘要，点击后打开 App；状态超过 15 分钟未更新会提示待更新。WidgetKit 决定刷新时机，App 关闭后不会在后台持续连接终端。组件使用系统颜色，自动跟随浅色、深色与主屏幕着色模式。真机签名时，主 App 与 Widget 扩展的 App Group 均需开通 `group.com.liy.SynapseMobile`。

终端仍然完全运行在电脑上。手机看到的是桌面端**已经渲染好的行**，而不是原始 PTY 字节——
`pnpm dev` 的 spinner、Claude Code 的 TUI 会产生大量 ANSI 控制序列，把它们送到手机上
既浪费流量又需要手机再做一遍解释。

终端页从**手机实际收到的行**收集当前会话的 HTTP/HTTPS 链接；已收到的链接即使被重绘
或滚出画面，仍留在「会话资源」中，直到会话移除或退出登录。未下发到手机的旧输出不会补抓。
桌面端在行帧中附带可选的软换行标记，使手机能拼回跨物理行的长 URL；旧帧仍可解码。
打开链接时由 WebKit 按主响应的类型和下载声明选择网页显示或下载，不按域名或扩展名分流。
上线时先更新服务端的共享协议校验，再更新桌面端和 iOS 客户端；旧服务端不接受带标记的行帧。

## 链路

```
iPhone ──wss──▶ Synapse 云 ──wss──▶ 桌面端网关 ──▶ Terminal 能力 ──▶ PTY
```

- **画面在桌面端合成**。桌面端用它已有的 `@xterm/headless` 仿真器读出每行的文本与样式，
  以「后缀替换」的语义下发：*从第 N 行起的内容是这些，后面的作废*。这条语义让帧天然幂等、
  丢帧自愈，因此不需要 ACK、重传队列或消息序号。
- **整窗快照从最新的一块开始发**。一帧装不下整个窗口（500 行约 5～7 帧），而手机是钉在
  它手上缓冲区的最底端的 —— 先发最老的一块，等于让它先跳到窗口的另一头再一段段走回来。
  所以带 `reset` 的是**最后**那一块，更早的块以 `history` 帧从上方补齐；这样每一帧到达时
  手机都在正确的位置上，中途丢一块也不会留下补不上的缺口。
- **只有正在查看的那一个终端产生持续流量**。会话列表只发摘要，且按内容变化触发，空闲时零上行。
- **手机不持有写租约**。桌面端网关代持，手机只发意图。用户在电脑上敲键盘会通过既有机制
  抢占租约；手机不提示这件事，下一次发送时自动把租约接管回来。
- **手机可以改 PTY 尺寸**。显示模式里的「优先移动端」让手机决定终端多宽：它把自己量到的
  格数上报，桌面据此重排，这样长行不折行、TUI 的方框也不会被打散。这与写租约正交，另有一套
  「尺寸归属」：手机断开即释放，桌面端只有点面板上的「转移到电脑」才夺回——拖动窗口、重新
  分屏都不算。桌面夺回后手机跟着切回「优先还原」，归属随摘要里的 `gridOwnerId` 下发。规则见
  `docs/adr/0216-coordinate-terminal-size-ownership-separately-from-leases.md` 和
  `docs/adr/0218-take-the-terminal-grid-back-only-on-an-explicit-release.md`。
- **默认「优先还原」**：PTY 尺寸不动，手机把电脑整屏缩放显示，布局与电脑逐格一致。
- **手机停在你选的那台电脑上，不会自己换台。** 一个账号可以同时登录多台电脑，手机端同一时刻
  只看其中一台：socket 是账号级的，每条指令的 payload 里带 `desktopClientInstanceId` 指名道姓，
  服务端只按 id 转发。看哪一台由你在终端列表页顶部的设备行上选（设置页的「已连接的电脑」是同一
  件事的另一个入口），选过就记住。正在看的那台掉线时手机停住并说清它不在线，而不是悄悄换到另
  一台；那台重新上线后自动接回去。电脑的名字走 `GET /api/mobile/desktops`——`mobile.presence`
  刻意只带 id（它是广播给账号下所有手机的，payload 有字节预算）。

## 开发

两个启动命令：

```bash
pnpm dev        # 全部本地：服务端、桌面端、文档站都指向 localhost
pnpm dev:prod   # 同上，但桌面端连生产环境 synapse.d2.pub
```

`dev:prod` 存在的原因是「桌面端连生产」这件事**不是持久的**：部署配置由
`generate:deployment-config.mjs` 在每次启动时重新生成，而那个脚本只读
`process.env`、不加载任何 `.env` 文件。忘了加环境变量，它会静默退回
`localhost` —— 手机端不会报错，只会看到空列表。

两个命令都起来之后，桌面端开一个终端，手机上的 App 就能看到它。

```bash
# 模拟器
xcodebuild -project SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

xcrun simctl install booted <SynapseMobile.app 路径>
xcrun simctl launch booted com.liy.SynapseMobile \
  -SynapseAPIBaseURL http://localhost:3001/api
```

服务器地址只能用 `-SynapseAPIBaseURL` 启动参数指定；默认指向 `https://synapse.d2.pub/api`。

### 端到端测试

`SynapseMobileUITests/TerminalFlowUITests.swift` 会走完整条链路：登录、会话列表、
需要我、打开终端、发送命令、按键往返、被抢占后的自动重放。它需要一个「桌面端」作为终端来源。

不希望打断你正在使用的 Synapse 时，可以用模拟桌面端：

```bash
# 一个测试账号
node server/test/mock-desktop.mjs <email> <password> http://127.0.0.1:3001

# 验多台电脑的切换：再起一个。两个必须不同名，否则选择器里是两行一样的字。
# 名字同时决定这个替身的 client id（`--instance-id` 可覆盖），所以它重启之后还是同一台
# 电脑——手机记住的是这个 id，换一个就等于把手机丢在一台再也不会回来的电脑上。
node server/test/mock-desktop.mjs <email> <password> http://127.0.0.1:3001 \
  --name "Mock iMac" --control-port 3012

# 另一个终端里（凭据通过 xctestrun 注入，见下）
xcodebuild test-without-building -xctestrun <…>.xctestrun \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/TerminalFlowUITests -parallel-testing-enabled NO
```

凭据通过 `SYNAPSE_TEST_EMAIL` / `SYNAPSE_TEST_PASSWORD` / `SYNAPSE_TEST_BASE_URL` 传入，
不要把真实账号写进测试文件。

另有两个 Node 冒烟脚本，验证云侧中继而不涉及任何客户端：

```bash
node server/test/mobile-relay-smoke.mjs   # 桌面与手机双向路由、离线答复、断开信号
```

### 云盘端到端

`SynapseMobileUITests/DriveAcceptanceUITests.swift` 走主页「云盘」那一行进去的整条链路：
下钻与面包屑、改名、新建 → 删除 → 回收站 → 恢复、多选移动与部分失败、建分享与停止分享、
上传、转屏后不丢当前文件夹与多选、`UIDocumentPicker` 的落点、「功能页不推入任何栈」的
结构判据。它不需要真账号：对面是 `server/test/mock-drive-server.mjs`，一个内存里的假网关
（云盘那一棵树 + 一个不验签的登录）。下面两条都在仓库根目录执行：

```bash
node server/test/mock-drive-server.mjs 8787

xcodebuild test -project SynapseMobile/SynapseMobile.xcodeproj -scheme SynapseMobile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:SynapseMobileUITests/DriveAcceptanceUITests -parallel-testing-enabled NO
```

替身没起来时整套 `XCTSkip`（判据是它自己那条 `/__reset` 探得到探不到），不算失败。地址默认
`http://127.0.0.1:8787/api`，可用 `SYNAPSE_TEST_DRIVE_BASE_URL` 换。上传与 picker 落点那两条
还要先在模拟器的「文件」里放一份样例文件，放法与它们在 iPad 上跑不过的原因都写在用例文件的
头注释里。

它替的是整个服务端，所以有两处它证明不了：登录不验签（任何凭据都能过），预览与下载的字节是
写死的。拿它验「这一屏拿到答复之后做得对不对」，不要拿它验「答复本身对不对」。

还有一格是这套用例**够不到**的：iPadOS 半窗 / 三分之一窗。`simctl`、Stage Manager 与
XCUITest 都改不了模拟器的窗口尺寸，所以窗口矩阵只有 iPhone 竖 ↔ 横、iPad 全屏竖 ↔ 横
实测过，`regular → compact` 的运行时转场没有证据（缺口与判据的边界记在
`docs/agents/mobile-adaptive-layout.md`）。

## 推送（可选，但这是核心场景）

没有推送时 App 完全可用，只是需要你主动打开才能看到等待中的请求。要启用锁屏批准：

1. 在 Apple 开发者后台 **Certificates, Identifiers & Profiles → Keys** 新建一个 Key，
   勾选 **Apple Push Notifications service (APNs)**，下载 `.p8`（只能下载一次）。
2. 记下 **Key ID**（形如 `ABC123DEFG`）。**Team ID** 是 `U4JT7UKH9W`。
3. 把 `.p8` 放到服务器上（例如 `/www/wwwroot/synapse/secrets/apns/AuthKey.p8`），
   并在 `server/.env.server` 填好：

   ```
   APNS_KEY_ID=ABC123DEFG
   APNS_TEAM_ID=U4JT7UKH9W
   APNS_KEY_PATH=/app/secrets/apns/AuthKey.p8
   APNS_BUNDLE_ID=com.liy.SynapseMobile
   APNS_USE_SANDBOX=false
   ```

   `APNS_USE_SANDBOX` **固定 `false`，不要动**。device token 分环境而服务端只有这一个开关，
   翻成 sandbox 会让**所有** TestFlight 用户的推送静默失效：苹果回 `BadDeviceToken`，服务端把
   这个 token 当死号永久删除且不重试，日志里只留一句 `Mobile push token rejected`。
   代价是数据线装的开发包收不到推送——这是接受的，不要为它切网关。调试完装回 TestFlight 并
   **重开一次 App** 就能恢复（旧 token 已被删除，不会自己回来）。
   理由与排查见 `.claude/skills/ios-release/SKILL.md`。
   `.p8` 需要挂载进容器（见 `server/compose.yml` 的 volumes）。
4. 重新部署后，App 启动时会自动注册设备令牌并写入 `UserDevice.pushToken`。

推送只在会话的 attention 从非 `waiting` 变为 `waiting` 时触发。`unknown` 不会推送——
它不是「不需要人」，但同样不是「需要人」的证据。

## 部署目标

`IPHONEOS_DEPLOYMENT_TARGET = 18.0`。iOS 26 的 Liquid Glass API 都用 `#available` 包着，
在旧系统上降级到系统材质，因此不把系统版本变成安装门槛。
