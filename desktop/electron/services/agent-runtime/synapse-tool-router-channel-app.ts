const preflight = "app_channels_publish_preflight_get"
const createChannel = "app_channels_channel_create"
const createToken = "app_channels_token_create"
const publishEvent = "app_channels_event_publish"
const getState = "app_channels_state_get"
const folderUpload = "app_drive_folder_upload"
const siteCreate = "app_drive_site_create"

export function channelAppSearchIntent(query: string, domain?: string): { toolNames: string[]; guidance: string } | null {
  if ((domain && domain !== "channels" && domain !== "drive") || /^app_[a-z_]+$/u.test(query)) return null
  if (/云端数据表|云表|\bcloud[ _-]+tables?\b/iu.test(query)) return null

  const remoteScreen = /(?:大屏|展示屏|投屏).{0,12}(?:遥控|控制|联动|手机)|(?:手机|网页).{0,8}遥控器|遥控.{0,8}(?:大屏|展示|幻灯片|页面)/iu.test(query)
  const webToBackend = /(?:网页|手机|页面|按钮).{0,12}(?:实时)?控制.{0,12}(?:后端|服务|电脑|本地|设备)|(?:实时信令|双向信令|实时频道)/iu.test(query)
  const channelCreate = /(?:创建|新建|做个|做一个|建立).{0,6}频道|\bcreate\s+(?:a\s+)?channel\b/iu.test(query)

  if (!remoteScreen && !webToBackend && !channelCreate) return null

  const guidance = "先读 Synapse Skill 的 channels/index.md 与 channels/remote-screen.md。先调用 app_channels_publish_preflight_get 检查当前桌面登录账号与公网地址，不要向用户索要个人 API 密钥。为不同客户端按最小权限签发角色凭证（subscribe / publish / pubsub），禁止把凭证放到 URL query 参数里；生成展示页或手机遥控页时，用云盘站点发布（app_drive_folder_upload + app_drive_site_create）托管。"

  if (remoteScreen || (webToBackend && /网页|页面|大屏|遥控/iu.test(query))) {
    const toolNames = domain === "channels"
      ? [preflight, createChannel, createToken, publishEvent, getState]
      : [preflight, createChannel, createToken, folderUpload, siteCreate]
    return { toolNames, guidance }
  }

  return {
    toolNames: [preflight, createChannel, createToken, publishEvent, getState],
    guidance,
  }
}
