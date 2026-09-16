# Synapse Remote (iOS)

用同一个 Synapse 账号在 iPhone 上查看和控制电脑上的终端。

终端仍然完全运行在电脑上。手机看到的是桌面端**已经渲染好的行**，而不是原始 PTY 字节——
`pnpm dev` 的 spinner、Claude Code 的 TUI 会产生大量 ANSI 控制序列，把它们送到手机上
既浪费流量又需要手机再做一遍解释。

## 链路

```
iPhone ──wss──▶ Synapse 云 ──wss──▶ 桌面端网关 ──▶ Terminal 能力 ──▶ PTY
```

- **画面在桌面端合成**。桌面端用它已有的 `@xterm/headless` 仿真器读出每行的文本与样式，
  以「后缀替换」的语义下发：*从第 N 行起的内容是这些，后面的作废*。这条语义让帧天然幂等、
  丢帧自愈，因此不需要 ACK、重传队列或消息序号。
- **只有正在查看的那一个终端产生持续流量**。会话列表只发摘要，且按内容变化触发，空闲时零上行。
- **手机不持有写租约**。桌面端网关代持，手机只发意图。用户在电脑上敲键盘会通过既有机制
  抢占租约；手机不提示这件事，下一次发送时自动把租约接管回来。
- **手机可以改 PTY 尺寸**。显示模式里的「优先移动端」让手机决定终端多宽：它把自己量到的
  格数上报，桌面据此重排，这样长行不折行、TUI 的方框也不会被打散。这与写租约正交，另有一套
  「尺寸归属」：手机断开即释放，桌面用户拖动窗口或重新分屏即夺回。规则见
  `docs/adr/0216-coordinate-terminal-size-ownership-separately-from-leases.md`。
- **默认「优先还原」**：PTY 尺寸不动，手机把电脑整屏缩放显示，布局与电脑逐格一致。

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

   `APNS_USE_SANDBOX` 取决于安装方式：**直接用数据线从 Xcode 装到手机的版本走 sandbox 网关，
   必须设为 `true`**；TestFlight 和 App Store 版本走生产网关，设为 `false`。
   `.p8` 需要挂载进容器（见 `server/compose.yml` 的 volumes）。
4. 重新部署后，App 启动时会自动注册设备令牌并写入 `UserDevice.pushToken`。

推送只在会话的 attention 从非 `waiting` 变为 `waiting` 时触发。`unknown` 不会推送——
它不是「不需要人」，但同样不是「需要人」的证据。

## 部署目标

`IPHONEOS_DEPLOYMENT_TARGET = 18.0`。iOS 26 的 Liquid Glass API 都用 `#available` 包着，
在旧系统上降级到系统材质，因此不把系统版本变成安装门槛。
