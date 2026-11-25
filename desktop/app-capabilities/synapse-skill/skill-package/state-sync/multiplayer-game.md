# 状态同步实战指南（零后端多人联机小游戏 / 协同网页）

示例请求：
- 「帮我做一个双人联机五子棋/井字棋小游戏，打开链接能建房并分享给朋友实时对战。」
- 「帮我做一个多人实时协同白板/投票/抢答网页，不需要自己写后端。」

## 1. 发布前检查（必须先做）

调用 `app_state_sync_publish_preflight_get`（参数 `{}`），核对返回字段：
- `ready`、`accountId`、`publicAppUrl`、`publicHttpBaseUrl`、`publicWsBaseUrl`
- `audience`：`local_only` / `public` / `environment_mismatch`
- `sdkManifestUrl`（`<publicAppUrl>/sdk/manifest.json`）、`latestStateSyncSdkVersion`、`sdkUrls.browserGlobal`

| `audience` | 处理方式 |
|---|---|
| `local_only` | 当前环境仅限本机访问，生成的联机页面链接仅本机有效，外网手机/好友无法加入；需向用户如实说明。 |
| `public` | 已配置公网地址；确认 `publicAppUrl` 为 `https://` 后使用返回的 `sdkUrls.browserGlobal` 与 `publicAppUrl`（若非 HTTPS 需先提醒用户）。 |
| `environment_mismatch` | 桌面端配置地址与当前登录服务端公网地址不一致，先向用户说明地址问题并停下，不继续创建空间或发布页面。 |

## 2. 创建同步空间

调用 `app_state_sync_space_create`：
- 填写清晰的 `name` 与 `description`。
- 按场景配置 `defaultDocTtlSeconds`（例如联机小游戏设为 `3600` 或 `86400` 秒，自动回收过期房间）与 `maxDocs`（如 `100`）。
- 记录返回的 `spaceId`。

## 3. 按最小权限签发空间凭证

调用 `app_state_sync_token_create`：
- 允许玩家直接在网页里点击“创建房间”：签发 `role: "create_write"` 凭证（返回一次性明文 `sys_...`）。
- 若有独立观战页：额外签发一把 `role: "read"` 凭证。
- 若由后台/MCP 预先创建固定房间、网页只负责加入：签发 `role: "write"` 凭证。
- **绝不把账号级个人 API 密钥（`syn_sk_...`）写进网页代码，也不要向用户索要个人 API 密钥。**

## 4. 生成自包含单文件 `index.html`

直接使用预检返回的 `sdkUrls.browserGlobal`（即 `<publicAppUrl>/sdk/state-sync/v1/state-sync.global.min.js`），无需任何构建工具或 npm 安装：

```html
<script src="<publicAppUrl>/sdk/state-sync/v1/state-sync.global.min.js"></script>
<script>
  const { createClient } = window.SynapseStateSync;
  const client = createClient({
    baseUrl: "<publicAppUrl>",
    spaceId: "<spaceId>",
    token: "<sys_create_write_token>",
  });

  // 房主建房：使用 create_write 空间凭证时不要传自定义 docId（由服务端生成随机 ssd_ ID）
  async function openRoom(initialState, myClientId, myName) {
    const { docId, room } = await client.createRoom({
      initialData: initialState,
      ttlSeconds: 3600,
      clientId: myClientId,
      clientName: myName,
      paths: ["/"],
    });
    const inviteUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(docId)}`;
    history.replaceState(null, "", inviteUrl);
    return { docId, room, inviteUrl };
  }

  // 好友通过 ?room=<docId> 加入房间
  async function joinRoom(docId, myClientId, myName) {
    return client.join(docId, {
      clientId: myClientId,
      clientName: myName,
      paths: ["/"],
    });
  }

  // 防并发冲突的落子/抢座：使用 room.transaction + abort / remove
  async function makeMove(room, index, player) {
    return room.transaction("/", (state, { abort }) => {
      if (!state || state.winner || state.turn !== player || state.board[index]) {
        return abort();
      }
      const nextBoard = state.board.slice();
      nextBoard[index] = player;
      return { ...state, board: nextBoard, turn: player === "X" ? "O" : "X" };
    });
  }

  // 掉线自动释放座位或标记离线，并在离开时调用 room.close()
  async function bindLifecycle(room, myClientId) {
    await room.onDisconnect([
      { op: "delete", path: `/players/${myClientId}` },
    ]);
    room.onPresence((members) => {
      // 更新在线玩家列表
    });
    window.addEventListener("pagehide", () => room.close());
  }
</script>
```

编写网页时注意：
- 凭据仅通过 SDK 首帧 `auth` 发送，严禁拼进 WebSocket URL query。
- 房间邀请链接通过 `?room=<docId>` 传递房间号（不含 token）；若需进一步限制公网写权限，也可让用户通过 URL `#token=...` 或输入框填写凭证。
- 所有会并发争抢的状态（如抢座位、轮流落子、抢答计数）必须走 `room.transaction(...)`，不要直接 `get` 后 `set`。

## 5. 通过云盘站点发布网页

1. 在本地新建包含 `index.html` 的目录，调用 `app_drive_folder_upload` 上传至云盘（例如「临时网页/<游戏名>」）。
2. 调用 `app_drive_site_create` 对该文件夹创建**网页分享**（**不要使用单文件分享**，单文件 HTML 分享预览会显示源码而非渲染页面）。
3. 后续修改页面时，覆盖上传 `index.html` 后调用 `app_drive_site_republish` 复用原 `/sites/<siteId>/` 链接。

## 6. 验收与交付

1. 如需预置演示房间，可用 `app_state_sync_doc_create` 创建房间并用 `app_state_sync_doc_get` 核对初始快照；联机测试后可用 `app_state_sync_doc_list` 查看活跃房间与 `onlineCount`。
2. 在最终回复中将 `/sites/<siteId>/` 链接**单独成行**输出给用户，并附上同步空间 ID、房间 TTL 说明及“如需收回访问权限，可随时撤销该空间凭证（`app_state_sync_token_revoke`）”的提示。
