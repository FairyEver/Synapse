# Cursor Token Usage UI Design

## 背景

Synapse token-usage 模块已完成 Cursor API 同步后端（凭证管理、CSV 拉取、解析入库），但缺少用户界面。用户无法通过 UI 连接 Cursor 账号或管理连接状态。

本设计覆盖从首次连接到日常使用的完整 UI 流程。

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 入口位置 | Agents 标签列表中的连接卡片 | 与现有 UI 融合度最高，不占额外空间 |
| Token 获取方式 | Electron BrowserWindow 内嵌登录 | 用户无需手动找 token，体验最流畅 |
| 登录窗口形态 | 独立弹窗 | 不干扰主窗口状态 |
| 登录交互 | 半自动（登录后确认账号） | 多账号场景清晰，用户知道连接了谁 |
| 连接后展示 | 数据融入现有图表 + 内联管理面板 | 自包含，不跳转，不新增页面 |

## 用户流程

### 首次连接

```
Agents 列表中看到 "Cursor · 未连接" (虚线卡片)
  → 点击卡片
  → Electron 弹窗打开 (800×600)
  → 加载 cursor.com/login
  → 用户完成登录
  → Synapse 检测到 WorkosCursorSessionToken cookie
  → 弹窗切换为确认页：显示邮箱 + 会员类型
  → 用户点击 "连接此账号"
  → 弹窗关闭
  → 触发首次同步 (cursorSync → scan)
  → Agents 列表中 Cursor 变为已连接状态
```

### 日常使用

Cursor 数据自动出现在 Overview / Models / Daily / Hourly / Agents 所有 tab 中，与 Claude Code、Codex 等并列，无需额外操作。每次 scan 自动同步最新数据。

### 账号管理

```
点击已连接的 Cursor 卡片
  → 展开内联管理面板
  → 可执行：手动同步 / 添加账号 / 断开连接
```

## 组件设计

### 1. CursorAgentCard（Agents 列表中的卡片）

**未连接状态：**
- 虚线边框 + 黄色背景
- 文字："Cursor · 未连接"
- 点击触发登录弹窗

**已连接状态：**
- 蓝色高亮背景（区别于其他 Agent 的绿色，表示"需要网络同步"）
- 文字："Cursor · {fileCount}"
- 点击展开/收起管理面板

### 2. CursorLoginWindow（Electron BrowserWindow 弹窗）

**窗口配置：**
- 尺寸：800×600，可调整大小
- 标题："连接 Cursor 账号"
- 无菜单栏
- 使用独立 session partition 避免污染主 session

**Cookie 监听逻辑：**
- 监听 `session.cookies` 的 `changed` 事件
- 过滤 domain 包含 `cursor.com`，name 为 `WorkosCursorSessionToken`
- 检测到 token 后调用 `cursorValidate` 验证
- 验证成功 → 显示确认 UI

**确认页面（BrowserWindow 内渲染）：**
- 显示：账号邮箱、会员类型（Pro/Free/Business）
- 按钮："连接此账号" / "取消"
- 连接 → 调用 `cursorAddAccount`，关闭窗口
- 取消 → 关闭窗口，不保存

### 3. CursorManagePanel（内联管理面板）

展开在 Cursor 卡片下方，包含：

**账号信息区：**
- 邮箱 + 会员类型
- 上次同步时间

**操作按钮：**
- "同步" — 调用 `cursorSync`，显示 loading 状态
- "添加账号" — 重新打开登录弹窗
- "断开" — 调用 `cursorRemoveAccount`，确认后执行

**多账号列表（如有多个）：**
- 每个账号一行：邮箱 + active 标记
- 点击切换 active 账号（调用 `cursorSetActive`）
- 每个账号可单独断开

## 文件结构

```
desktop/src/modules/token-usage/
├── components/
│   ├── cursor-agent-card.tsx      # Agents 列表中的 Cursor 卡片
│   ├── cursor-manage-panel.tsx    # 内联管理面板
│   └── cursor-login-dialog.tsx    # 触发登录弹窗的逻辑组件
├── hooks/
│   └── use-cursor-accounts.ts     # Cursor 账号状态 hook
```

```
desktop/electron/
├── services/token-usage/cursor-sync/
│   └── login-window.ts            # BrowserWindow 创建 + cookie 监听
├── token-usage/
│   ├── channels.ts                # 新增 cursorLogin channel
│   └── ipc-handlers.ts            # 新增 cursorLogin handler
```

## IPC 新增

现有 IPC 已覆盖大部分需求，仅需新增一个：

| Channel | 用途 |
|---------|------|
| `synapse:token-usage:cursor:login` | 打开登录弹窗，返回 `{ success, accountId }` |

其余操作复用已有 channels：
- `cursor:list-accounts` — 获取账号列表
- `cursor:sync` — 手动同步
- `cursor:remove-account` — 断开
- `cursor:set-active` — 切换 active

## 技术细节

### Cookie 监听

```typescript
// login-window.ts 核心逻辑
const win = new BrowserWindow({
  width: 800, height: 600,
  webPreferences: { partition: "cursor-login" }
})

win.webContents.session.cookies.on("changed", (event, cookie) => {
  if (cookie.name === "WorkosCursorSessionToken" && cookie.domain?.includes("cursor")) {
    // 提取 token，验证，显示确认
  }
})

win.loadURL("https://cursor.com/login")
```

### 确认页面

登录成功后，BrowserWindow 加载本地 HTML（`file://` 协议），显示账号信息和确认按钮。通过 preload script 与主进程通信。

### 错误处理

- 登录超时（用户关闭弹窗）：静默处理，不报错
- Token 验证失败：弹窗内显示错误提示，允许重试
- 同步失败：管理面板显示错误状态 + 重试按钮
- 网络断开：使用缓存数据，管理面板显示"离线"状态

## 不做的事

- 不新增 tab 或独立页面
- 不在 Settings 中放 Cursor 配置
- 不要求用户手动粘贴 token
- 不做 token 自动刷新（Cursor session token 有效期很长）
- 不做定时自动同步（跟随 scan 即可）
