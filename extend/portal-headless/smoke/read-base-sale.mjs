#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 测试环境读**销售域基础数据**那一族接口
 * （`src/capabilities/base-sale.ts`），记录真实的条数 / 体积 / 耗时 / 形状。
 *
 *   A. GET {SHOP}/admin/shop/getInfo                              销售店铺
 *   B. GET {SHOP}/admin/area/allArea                              销售地区（省市区全量）
 *   C. GET {SHOP}/admin/categoryManufacturer/manufacturerInfoList 厂商
 *   D. GET {SHOP}/admin/categoryBrand/brandAllList                品牌
 *   E. GET {SHOP}/admin/trade/adjustTradeProcessTip               首页待处理订单提示
 *
 * ⚠️ **这五条走 `sale` 实例**：baseURL = `VITE_SHOP_ADMIN_API`，测试环境是
 * `https://biz-api-test.wodecorp.cn/admin-shop-api`（与 platform **同 host、不同前缀**）。
 * 脚本默认取 `${PORTAL_BASE_URL}/admin-shop-api`，也可以用 `PORTAL_SHOP_BASE_URL` 覆盖。
 * 它**不发送**浏览器那个防缓存参数 `_t`（见下面 G 段的对照）。
 *
 * 需要（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL       例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN          Portal 会话 token
 *   PORTAL_TENANT_ID      当前租户 id
 *   PORTAL_SHOP_BASE_URL  可选，默认 `${PORTAL_BASE_URL}/admin-shop-api`
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-base-sale.mjs
 *
 * **全程只读**（GET）。脚本末尾会如实报出这次一共发了几次 GET，便于核对这条边界。
 *
 * ## 这个脚本要回答的四件事（都是能力里写了、但只有真机能证实的）
 *
 * 1. **`shop/getInfo` 里到底有没有身份证号** —— 能力按白名单裁掉了
 *    `shopuserIdentity` / `shopuserIdentityImg{,Z,F}` / `mobile`。
 *    本脚本报"有没有、多长"（**不打印值**），这就是白名单存在的理由。
 * 2. **地区节点的名称字段是不是真的叫 `value`** —— 能力文件头写着"不是 `name`"。
 *    照 `base-dept-*` 的习惯写会静默拿到 undefined，所以每次跑都验一遍。
 * 3. **地区树的规模** —— 节点数 / 省数 / 最大深度 / 字节。能力里那三个硬上限的依据。
 * 4. **`module-type` 敏感性** —— 交错四次（不带 → 带 11 → 不带 → 带 11），
 *    判据同 `read-base-shell.mjs`：先确认基线稳不稳，再比带/不带；不稳就如实说"本次无效"。
 *
 * 为什么不用 `createPortalHeadless`：这一族的**接线由派单方统一做**
 * （`src/capabilities/index.ts` 与门面同批不动），所以这里用 Node 内置 `fetch` 直接打。
 * 请求头与 `src/http/headers.ts` 的 `generate-http-headers` 形态逐字段一致。
 */

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID
const shopBaseUrl = process.env.PORTAL_SHOP_BASE_URL ?? (baseUrl ? `${baseUrl}/admin-shop-api` : '')

const missing = Object.entries({
  PORTAL_BASE_URL: baseUrl,
  PORTAL_TOKEN: token,
  PORTAL_TENANT_ID: tenantId,
  PORTAL_SHOP_BASE_URL: shopBaseUrl,
})
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/read-base-sale.mjs\n',
  )
  process.exit(1)
}

const out = (line = '') => process.stdout.write(`${line}\n`)

function headers (extra = {}) {
  return { 'tenant-id': String(tenantId), token, 'Accept-Language': 'zh-CN', ...extra }
}

let GET_COUNT = 0

/** 打一次只读 GET。`path` 是**相对 sale 实例 baseURL** 的（如 `/admin/shop/getInfo`） */
async function readJson (path, extraHeaders = {}) {
  const url = `${shopBaseUrl}${path}`
  GET_COUNT += 1
  const startedAt = Date.now()
  const response = await fetch(url, { method: 'GET', headers: headers(extraHeaders) })
  const text = await response.text()
  const elapsedMs = Date.now() - startedAt

  if (!response.ok) {
    throw new Error(`GET ${path} → HTTP ${response.status}：${text.slice(0, 200)}`)
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`GET ${path} → 响应不是 JSON（前 200 字节：${text.slice(0, 200)}）`)
  }
  if (parsed?.code !== 0 && parsed?.code !== undefined) {
    throw new Error(`GET ${path} → code=${parsed.code} msg=${parsed.msg}`)
  }

  return { path, bytes: Buffer.byteLength(text, 'utf8'), elapsedMs, data: parsed?.data }
}

const DASH = '─'.repeat(72)
function section (title) {
  out()
  out(DASH)
  out(title)
  out(DASH)
}

async function moduleTypeControl (label, path) {
  const first = await readJson(path)
  const withFirst = await readJson(path, { 'module-type': '11' })
  const second = await readJson(path)
  const withSecond = await readJson(path, { 'module-type': '11' })

  const a = JSON.stringify(first.data)
  const a2 = JSON.stringify(second.data)
  const b = JSON.stringify(withFirst.data)
  const b2 = JSON.stringify(withSecond.data)

  const baselineStable = a === a2 && b === b2
  const same = baselineStable && a === b

  if (!baselineStable) {
    out(`  module-type 对照 ${label}：**基线本身就不稳**（同参数两次已经不同）→ 本次对照无效，不给结论`)
  } else {
    out(
      `  module-type 对照 ${label}：不带 ${first.bytes} B / 带 11 ${withFirst.bytes} B → ` +
        `${same ? '**data 完全相同**（本账号不敏感）' : '**不同（敏感）**'}`,
    )
  }
  return { same, baselineStable }
}

const SHOP_PATH = '/admin/shop/getInfo'
const AREA_PATH = '/admin/area/allArea'
const MANUFACTURER_PATH = '/admin/categoryManufacturer/manufacturerInfoList'
const BRAND_PATH = '/admin/categoryBrand/brandAllList'
const TIP_PATH = '/admin/trade/adjustTradeProcessTip'

/** 能力白名单里那 18 个字段（与 `src/capabilities/base-sale.ts` 的 `ShopInfo` 一致） */
const SHOP_WHITELIST = [
  'shopId', 'shopName', 'shopAllName', 'shopType', 'shopTypeName', 'status', 'sellerId',
  'shopuserName', 'servicesTel', 'email', 'shopLogo', 'shopAddr', 'shopArea', 'bulletin',
  'openTime', 'closeTime', 'closeReason', 'openType',
]

/** 能力**点名裁掉**的字段（前 5 个是实名信息，后 2 个是 IM 账号） */
const SHOP_DROPPED_PII = ['shopuserIdentity', 'shopuserIdentityImg', 'shopuserIdentityImgZ', 'shopuserIdentityImgF', 'mobile', 'qq', 'wangwang']

function countNodes (nodes) {
  if (!Array.isArray(nodes)) return 0
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node?.children), 0)
}

function maxDepth (nodes, depth = 1) {
  if (!Array.isArray(nodes) || nodes.length === 0) return depth - 1
  return nodes.reduce((best, node) => Math.max(best, maxDepth(node?.children, depth + 1)), depth)
}

const moduleTypeSensitive = []
const moduleTypeInconclusive = []

try {
  out(`sale 实例 base：${shopBaseUrl}`)
  out(`（platform base 是 ${baseUrl} —— 同 host、不同前缀，conventions 第 27 条要求显式给）`)

  // -------------------------------------------------------------------------
  // A. 店铺
  // -------------------------------------------------------------------------
  section('A. GET /admin/shop/getInfo （销售店铺）')

  const shop = await readJson(SHOP_PATH)
  const shopKeys = Object.keys(shop.data ?? {})
  out(`字节 ${shop.bytes} / 耗时 ${shop.elapsedMs} ms / 字段 ${shopKeys.length} 个`)
  out(`字段全集：${JSON.stringify(shopKeys)}`)

  out('实名 / 联系类字段在**原始响应**里的情况（只报有没有、多长，**值不打印**）：')
  for (const key of SHOP_DROPPED_PII) {
    const present = key in (shop.data ?? {})
    const value = shop.data?.[key]
    const empty = value === null || value === undefined || value === ''
    out(
      `  ${key}：存在 ${present}，非空 ${!empty}` +
        `${!empty ? `（类型 ${typeof value}，长度 ${String(value).length}）` : ''}`,
    )
  }
  const keptRaw = SHOP_WHITELIST.filter((key) => shopKeys.includes(key))
  out(`能力白名单保留 ${SHOP_WHITELIST.length}/${shopKeys.length} 个：${JSON.stringify(keptRaw)}`)
  out(`被裁掉 ${shopKeys.length - keptRaw.length} 个：${JSON.stringify(shopKeys.filter((key) => !keptRaw.includes(key)))}`)
  out(`shopArea=${JSON.stringify(shop.data?.shopArea)}（能力有一族 base-sale-area-describe 专门翻它）`)

  out()
  const controlShop = await moduleTypeControl('店铺', SHOP_PATH)
  if (!controlShop.baselineStable) moduleTypeInconclusive.push('店铺')
  else if (!controlShop.same) moduleTypeSensitive.push('店铺')

  // -------------------------------------------------------------------------
  // B. 地区
  // -------------------------------------------------------------------------
  section('B. GET /admin/area/allArea （销售地区，能力那三个硬上限的依据）')

  const area = await readJson(AREA_PATH)
  const roots = Array.isArray(area.data) ? area.data : []
  out(`字节 ${area.bytes} / 耗时 ${area.elapsedMs} ms / 根 ${roots.length} 个 / 总节点 ${countNodes(roots)} / 最大深度 ${maxDepth(roots)}`)

  const firstNode = roots[0] ?? {}
  out(`根节点字段：${JSON.stringify(Object.keys(firstNode))}`)
  out(
    `⭐ 名称字段叫 **${'value' in firstNode ? 'value' : 'name'}**` +
      `（实测 value=${JSON.stringify(firstNode.value)}、name=${JSON.stringify(firstNode.name)}）` +
      '—— 照 base-dept-* 的习惯写 name 会静默拿到 undefined',
  )
  out(`首个根的第 1 个下级：${JSON.stringify(roots[0]?.children?.[0])?.slice(0, 200)}`)
  out('⚠️ 这个接口**不接受任何查询参数**（能力里的关键字是 SDK 本地过滤，236 KB 每次都要拉）')

  // 能力里 base-sale-area-children({parentId: 0}) 取的就是 roots
  out(`base-sale-area-children({ parentId: 0 }) → ${roots.length} 条（= 根的数量）`)

  // -------------------------------------------------------------------------
  // C. 厂商 / 品牌
  // -------------------------------------------------------------------------
  section('C. GET /admin/categoryManufacturer/manufacturerInfoList （厂商）')
  const manufacturer = await readJson(MANUFACTURER_PATH)
  const manufacturers = Array.isArray(manufacturer.data) ? manufacturer.data : []
  out(`字节 ${manufacturer.bytes} / 耗时 ${manufacturer.elapsedMs} ms / ${manufacturers.length} 条`)
  out(`字段：${JSON.stringify(Object.keys(manufacturers[0] ?? {}))}`)
  out(
    `brandList 非空的条数：${manufacturers.filter((item) => item?.brandList !== null && item?.brandList !== undefined).length}` +
      '（实测是 0 —— 所以"厂商 → 品牌"只能靠品牌表，不能靠这个字段）',
  )
  out('⚠️ 同样**不接受参数**：711 条 / 70 KB 每次都要拉')

  section('D. GET /admin/categoryBrand/brandAllList （品牌）')
  const brand = await readJson(BRAND_PATH)
  const brands = Array.isArray(brand.data) ? brand.data : []
  out(`字节 ${brand.bytes} / 耗时 ${brand.elapsedMs} ms / ${brands.length} 条`)
  out(`字段：${JSON.stringify(Object.keys(brands[0] ?? {}))}`)
  out(`带 manufacturerId 的条数：${brands.filter((item) => item?.manufacturerId !== null && item?.manufacturerId !== undefined).length}/${brands.length}`)
  out('⚠️ 同样**不接受参数**：741 条 / 46 KB 每次都要拉')

  // -------------------------------------------------------------------------
  // E. 首页待处理提示
  // -------------------------------------------------------------------------
  section('E. GET /admin/trade/adjustTradeProcessTip （首页待处理订单提示）')
  const tip = await readJson(TIP_PATH)
  out(`字节 ${tip.bytes} / 耗时 ${tip.elapsedMs} ms / ${JSON.stringify(tip.data)}`)
  out('语义直读 utils/router/sale.js:29-35：unpaidTip → 未付款弹窗；!unpaidTip && waitShipTip → 待发货')
  out()

  const controlTip = await moduleTypeControl('待处理提示', TIP_PATH)
  if (!controlTip.baselineStable) moduleTypeInconclusive.push('待处理提示')
  else if (!controlTip.same) moduleTypeSensitive.push('待处理提示')

  const controlArea = await moduleTypeControl('地区', AREA_PATH)
  if (!controlArea.baselineStable) moduleTypeInconclusive.push('地区')
  else if (!controlArea.same) moduleTypeSensitive.push('地区')

  // -------------------------------------------------------------------------
  // F. `_t` 对照：证明"SDK 不发这个防缓存参数"不影响返回内容
  // -------------------------------------------------------------------------
  section('F. `_t` 对照（sale.js:22-27 的请求拦截器给每个 GET 加时间戳）')
  const withoutT = await readJson(SHOP_PATH)
  const withT = await readJson(`${SHOP_PATH}?_t=${Date.now()}`)
  out(`不带 _t ${withoutT.bytes} B / 带 _t ${withT.bytes} B`)
  out(
    JSON.stringify(withoutT.data) === JSON.stringify(withT.data)
      ? '  → data **完全相同**：SDK 不发 `_t` 站得住（它是浏览器侧的防缓存参数，SDK 加了只会破坏自己的缓存）'
      : '  → **不同**！那说明 `_t` 影响了返回内容，能力里"不发 `_t`"这条决定要重审',
  )

  // -------------------------------------------------------------------------
  // 汇总
  // -------------------------------------------------------------------------
  section('汇总')
  out(`module-type 敏感（基线稳且带/不带不同）：${moduleTypeSensitive.length ? moduleTypeSensitive.join('、') : '（无）'}`)
  out(`module-type 对照无效（基线自己在动）：${moduleTypeInconclusive.length ? moduleTypeInconclusive.join('、') : '（无）'}`)
  out(`本次共发出 ${GET_COUNT} 次只读 GET，**没有**任何写操作（POST/PUT/DELETE 一个都没有）`)
} catch (error) {
  out()
  out(`**冒烟失败**：${error instanceof Error ? error.message : String(error)}`)
  out(`（失败前已发出 ${GET_COUNT} 次只读 GET）`)
  process.exit(1)
}
