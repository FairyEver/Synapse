const preflight = "app_state_sync_publish_preflight_get"
const createSpace = "app_state_sync_space_create"
const createToken = "app_state_sync_token_create"
const createDoc = "app_state_sync_doc_create"
const mutateDoc = "app_state_sync_doc_mutate"
const getDoc = "app_state_sync_doc_get"
const folderUpload = "app_drive_folder_upload"
const siteCreate = "app_drive_site_create"

export function stateSyncAppSearchIntent(query: string, domain?: string): { toolNames: string[]; guidance: string } | null {
  if ((domain && domain !== "state_sync" && domain !== "drive") || /^app_[a-z_]+$/u.test(query)) return null
  if (/云端数据表|云表|\bcloud[ _-]+tables?\b/iu.test(query)) return null
  if (/云盘|网盘|云文档|\bdrive\b|邮件|邮箱|\bmail\b/iu.test(query) && domain !== "state_sync") return null
  if (/频道|\bchannels?\b/iu.test(query) && !/状态同步|\bstate[ _-]+sync\b/iu.test(query)) return null

  const multiplayerGame = /(?:多人|双人|联机|实时).{0,10}(?:小游戏|游戏|对战|五子棋|井字棋|棋盘|猜词|你画我猜|白板|抢答|协作|房间)|联机小游戏|多人对战|开房间|房间同步/iu.test(query)
  const sharedJson = /(?:共享|实时同步|多人同步).{0,8}(?:json|状态树|房间状态|数据)|野狗|\bwilddog\b|firebase.{0,8}(?:realtime|实时)|实时状态树/iu.test(query)
  const sdkDiscovery = /(?:状态同步|state[ _-]*sync|联机).{0,12}(?:sdk|清单|manifest)|sdk.{0,10}(?:最新|版本|链接|地址|cdn|下载|清单)/iu.test(query)
  const spaceCreate = /(?:创建|新建|做个|做一个|建立).{0,6}(?:同步空间|状态同步)|\bcreate\s+(?:a\s+)?state[ _-]*sync\s+space\b/iu.test(query)
  const generalStateSync = /(?:状态同步|\bstate[ _-]+sync\b)/iu.test(query)
    && !/(?:列表|列出|查询|读取|更新|修改|删除|撤销|写入|发布前检查|同步空间|状态房间|凭证)/u.test(query)

  if (!multiplayerGame && !sharedJson && !sdkDiscovery && !spaceCreate && !generalStateSync) return null

  const guidance = "先读 Synapse Skill 的 state-sync/index.md 与 state-sync/multiplayer-game.md。先调用 app_state_sync_publish_preflight_get 获取当前账号、公网地址与最新 SDK 链接（/sdk/manifest.json 与 state-sync.global.min.js），不要向用户索要个人 API 密钥。浏览器端只使用空间专属凭证（sys_...，动态建房用 create_write 且不传自定义 docId），严禁把凭证放进 URL query；生成零后端联机小游戏或协同页面时，用云盘站点发布（app_drive_folder_upload + app_drive_site_create）托管。"

  if (multiplayerGame) {
    const toolNames = domain === "state_sync"
      ? [preflight, createSpace, createToken, createDoc, mutateDoc]
      : [preflight, createSpace, createToken, folderUpload, siteCreate]
    return { toolNames, guidance }
  }

  if (sdkDiscovery) {
    return {
      toolNames: [preflight, createSpace, createToken, createDoc, getDoc],
      guidance,
    }
  }

  return {
    toolNames: [preflight, createSpace, createToken, createDoc, mutateDoc],
    guidance,
  }
}
