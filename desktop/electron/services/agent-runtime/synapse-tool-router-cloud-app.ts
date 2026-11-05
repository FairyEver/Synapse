const preflight = "app_cloud_tables_publish_preflight_get"
const permissions = "app_cloud_tables_permissions_update"
const upload = "app_drive_file_upload"
const folderUpload = "app_drive_folder_upload"
const share = "app_drive_share_create"
const site = "app_drive_site_create"
const imageUpload = "app_drive_direct_link_upload"

export function cloudTableAppSearchIntent(query: string, domain?: string): { toolNames: string[]; guidance: string } | null {
  if ((domain && domain !== "cloud_tables" && domain !== "drive") || /^app_[a-z_]+$/u.test(query)) return null
  if (/飞书|金数据|问卷星|微信接龙|Google Forms|Typeform|Airtable/iu.test(query)) return null
  if (/生成器|\bEJS\b/iu.test(query)) return null
  const publication = query.replace(/(?:不要|不用|无需|不需要|不|别)(?:发布|分享|上线|上传)(?:网站|网页|站点)?/gu, "")
  const publish = /分享|发布|上线|上传|公网|给.{0,6}(?:别人|大家)|\b(?:publish|share|deploy|upload)\b/iu.test(publication)
  if (/(?:组件|校验函数|component|validation function)/iu.test(query) && !publish) {
    return { toolNames: [], guidance: "仅开发表单组件或校验函数不需要 Synapse 远端写入。按项目要求实现组件，不创建云表、不开放匿名权限、不发布网页。" }
  }
  const positive = query.replace(/(?:不要|不用|无需|不需要)(?:做|创建|生成)?(?:报名(?:页|表)|表单|问卷)/gu, "")
  const form = /报名(?:页|表|链接|单|人数|总数)|登记[页表]|征集[页表]|表单|问卷|投票|\b(?:registration|signup|sign-up|survey|poll|form)\b/iu.test(positive)
  const app = /网页|网站|站点|页面|\b(?:website|webpage|site|page|html)\b/iu.test(positive)
  const collect = /收集|征集|填写|填完|提交|大家填|任何人.{0,4}填|\b(?:collect|fill|submit|submissions?)\b/iu.test(positive)
  const persist = /保存.{0,6}数据|数据.{0,6}(?:保存|存储)|入库|云存储|后端|数据库|\b(?:backend|database|persist|stores?)\b/iu.test(positive)
  const localOnly = /(?:不需要|不要|无需|不用).{0,4}(?:云表|云存储|后端|数据库|保存数据)|(?:只|仅).{0,6}本地.{0,6}(?:保存|存储)|\b(?:without|no) (?:a )?(?:backend|cloud storage)|\blocalStorage\b/iu.test(query)
  const edit = /加上?|新增|更新|改|原链接|\b(?:add|update|existing|same link)\b/iu.test(positive)
  const counts = /榜单|人数|总数|汇总|公开统计|\b(?:leaderboard|totals?|counts?)\b/iu.test(positive)
  const create = /做|建|生成|发|发布|上传|上线|给.{0,6}链接|\b(?:build|create|make|publish|share|upload|deploy)\b/iu.test(positive)
  const cloud = !localOnly && (form || (app && persist) || ((app || /链接|\blink\b/iu.test(positive)) && collect))
  const assets = /多(?:个)?(?:文件|资源)|多页|本地(?:图片|资源)|相对(?:路径|资源)|独立(?:脚本|样式)|构建(?:目录|产物)|assets|\b(?:multi-file|multi-page|local assets|bundle)\b/iu.test(query)
  const imageHosting = /(?:图床|公开素材|图片.{0,8}(?:直链|外链)|\bimage hosting\b)/iu.test(query)
    && !/(?:不要|不用|无需|不需要)[^，。；,;]{0,8}(?:图床|公开素材|图片.{0,4}(?:直链|外链)|image hosting)/iu.test(query)
  const guidance = "先读 Synapse Skill 的 web-publishing/index.md。需要云端表单存储时先调用发布前检查，使用当前桌面登录账号。明确要求图床时先上传每张图片，拿齐链接后改写网页、CSS 等引用，再检查最终产物：独立单文件用文件分享，多文件或本地资源用站点分享；未要求图床不创建公开素材。按需继续发现后续工具，搜索结果不代表授权。公开人数用独立计数权限，名单仍关闭匿名读取。更新复用原文件分享或原站点并重新发布。"
  const existing = /原链接|原网页|原网站|原站点|现有|已有|\b(?:existing|same link)\b/iu.test(positive)
  if (!localOnly && (form || app || /链接|\blink\b/iu.test(positive)) && edit && counts && (!create || existing)) {
    return { toolNames: [preflight, "app_cloud_tables_table_get", permissions, "app_drive_link_resolve", assets ? folderUpload : upload], guidance }
  }
  if (cloud && create) {
    return { toolNames: [preflight, "app_cloud_tables_table_create", permissions, ...(imageHosting ? [imageUpload] : []), ...(assets ? [folderUpload, site] : [upload, share])], guidance }
  }
  if (!app || !create) return null
  if (/重新发布|再次发布|\brepublish\b/iu.test(query)) {
    return { toolNames: ["app_drive_link_resolve", "app_drive_site_republish"], guidance }
  }
  if (imageHosting) return { toolNames: [imageUpload, upload, share, folderUpload, site], guidance }
  if (assets) return { toolNames: [folderUpload, site], guidance }
  if (/单文件|\b(?:standalone|single-file)\b/iu.test(query)) return { toolNames: [upload, share], guidance }
  return { toolNames: [upload, share, folderUpload, site], guidance }
}
