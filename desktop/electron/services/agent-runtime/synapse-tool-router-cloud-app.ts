const preflight = "app_cloud_tables_publish_preflight_get"
const permissions = "app_cloud_tables_permissions_update"
const upload = "app_drive_file_upload"

export function cloudTableAppSearchIntent(query: string, domain?: string) {
  if ((domain && domain !== "cloud_tables") || /^app_[a-z_]+$/u.test(query)) return null
  if (/飞书|金数据|问卷星|微信接龙|Google Forms|Typeform|Airtable/iu.test(query)) return null
  const form = /报名(?:页|表|链接|单|人数|总数)|登记[页表]|征集[页表]|表单|问卷|投票|\b(?:registration|signup|sign-up|survey|poll)\b/iu.test(query)
  const app = /网页|页面|链接|\b(?:page|link|form)\b/iu.test(query)
  const collect = /收集|征集|填写|大家填|任何人.{0,4}填|\b(?:collect|fill|submit)\b/iu.test(query)
  const edit = /加上?|新增|更新|改|原链接|\b(?:add|update|existing|same link)\b/iu.test(query)
  const counts = /榜单|人数|总数|汇总|公开统计|\b(?:leaderboard|totals?|counts?)\b/iu.test(query)
  if ((form || app) && edit && counts) return [preflight, "app_cloud_tables_table_get", permissions, "app_drive_link_resolve", upload]
  const create = /做|建|生成|发|发布|给.{0,6}链接|\b(?:build|create|make|publish|share)\b/iu.test(query)
  if ((form || (app && collect)) && create) return [preflight, "app_cloud_tables_table_create", permissions, upload, "app_drive_share_create"]
  return null
}
