/**
 * **第三批基础能力 · 其二：销售域基础数据**（`base-sale-*`）。
 *
 * 这是首屏 `runLegacyFullInitTasks`（`app/portal/utils/router/session.js:35-59`）里
 * **剩下最大的一块**——`docs/base-capabilities.md` §2.1 的 #14~#17 与 §2.2 的 #20，
 * 五条**每次刷新都打**的接口，一条都没能力化：
 *
 * | # | 接口（走 `sale` 实例，base = `VITE_SHOP_ADMIN_API`） | 用途 | 实测（2026-09-20，租户 1；字节是稳定的，耗时按次浮动） |
 * | --- | --- | --- | --- |
 * | 14 | GET `/admin/shop/getInfo` | 销售店铺 | **1,928 B / 43 字段 / 约 300 ms** |
 * | 15 | GET `/admin/area/allArea` | 销售地区（省市区全量） | **235,914 B / 3440 节点 / 34 个省 / 深度 3 / 约 260 ms** |
 * | 16 | GET `/admin/categoryManufacturer/manufacturerInfoList` | 厂商 | **70,208 B / 711 条 / 约 190 ms** |
 * | 17 | GET `/admin/categoryBrand/brandAllList` | 品牌 | **46,533 B / 741 条 / 约 210 ms** |
 * | 20 | GET `/admin/trade/adjustTradeProcessTip` | 首页待处理订单提示 | **89 B / 约 150 ms** |
 *
 * ⚠️ 一条**自我纠错**：本节初稿把店铺写成"46 个字段"，那是数错了（数的是打印出来的 JSON）。
 * 实测**是 43 个**。`smoke/read-base-sale.mjs` 每次跑都会重新数一遍字段全集与白名单的取舍。
 *
 * 调用点：`app/portal/utils/system.js` 的 `fetchShopInfo` / `fetchAreaInfo` /
 * `fetchManufacturerInfo` / `fetchBrandInfo`（分别 1126 / 1142 / 1158 / 1174 行，
 * 全部 `httpSale.get(...)`，全部 `silenceOnError: true`），与 `utils/router/sale.js:29,32`
 * 的 `handlePendingOrder`（**仅 `to.path === '/dashboard/home'` 才打**）。
 *
 * ---------------------------------------------------------------------------------------
 * 一、为什么挑它：三条标准里**第 1 条不成立，如实写在最前面**
 * ---------------------------------------------------------------------------------------
 *
 * - **①「别的能力依赖它」——不成立。** 本仓库现有的 48 个能力里**没有一个**是销售域的，
 *   所以今天没有任何能力依赖这份数据。它是**为将来的销售域页面能力预铺的地基**，
 *   不是被依赖的地基。这条差别必须说清楚，别把它读成"已经有下游在等"。
 * - **②「是刷新时必打的『外壳』接口」——成立，且是剩下最大的一块。**
 *   首屏 21 个后端接口里，除掉已做的（第一、二批）与#20 之外的 4 条，
 *   这一族一次占了 5 条；它们与用户落在哪个页面无关，`Promise.all` 里并发打。
 * - **③「契约清晰、能只读验证」——成立。** 五条全是无参 GET（实测后端不接受任何查询参数），
 *   本文件的每个数字都来自真实环境的只读冒烟 `smoke/read-base-sale.mjs`。
 *
 * ⚠️ **接线前提（不满足这个能力会抛错，不会静默打错地址）**：这五条走的是 `sale` 实例，
 * 它的 baseURL 是 `VITE_SHOP_ADMIN_API`，在测试环境是
 * `https://biz-api-test.wodecorp.cn/admin-shop-api`——**与 platform 同 host、不同前缀**
 * （`build/env/.env.build.test:21`）。conventions 第 27 条：这种「同 host 不同前缀」的范围决策
 * **SDK 不替调用方做**，必须由接线方显式给 base。所以本文件的工厂收的是**单独的** `saleRequest`，
 * 没给就在调用时抛 `SaleNotWiredError`，并在消息里写明两种接法。理由与第二批拒绝
 * `{CRM}` / `{SHOP}` 那批不同：**不是"跑不到"，是"要显式配 base"**——本单已经实测跑通了
 * （见上面的数字），所以这次做，上次不做。
 *
 * ---------------------------------------------------------------------------------------
 * 二、敏感字段：`shop/getInfo` 里有**身份证号与证件照 URL**，必须裁
 * ---------------------------------------------------------------------------------------
 *
 * `GET /admin/shop/getInfo` 实测返回 **43 个字段**（白名单留 18、裁 25），其中这一组是实名信息：
 *
 * | 字段 | 实测（真机形状；**值不落盘**） | 处置 |
 * | --- | --- | --- |
 * | `shopuserIdentity` | 非空字符串，**长度 18** —— 18 位身份证号 | **裁掉** |
 * | `shopuserIdentityImg` | 非空字符串，长度 **240**（`a:2:{…}` 序列化串，里面是两张证件照 URL） | **裁掉** |
 * | `shopuserIdentityImgZ` / `shopuserIdentityImgF` | 非空字符串，长度各 **100**（证件照正面 / 反面 URL） | **裁掉** |
 * | `mobile` | 非空字符串，长度 **11** —— 个人手机号 | **裁掉** |
 *
 * 处置方式与第一批（`password2`/`salt`）、第二批（同）、本批的 `base-tenant`（`identityNumber`）
 * 完全一致：**白名单**。`ShopInfo` 类型里没有的字段一定不会被返回。
 *
 * 顺带裁掉的是**店铺装修/展示开关与内部标记**（实测裁掉的那 25 个里，除上面 5 个实名字段外的 20 个）：
 * `qq`、`wangwang`、`zzts`（种子/追溯标记）、`isShowShopName`、`isShowShopLogo`、
 * `isShowShopBackground`、`isShowShopDescript`、`isShopDecorated`、`undecoratedItem`、
 * `isShopPcDecorated`、`pcUndecoratedItem`、`isIntegrateSap`、`isOpenSynchro`、
 * `isOpenRechargePayment`、`shopDescript`、`typeSuffix`、`shopInfo`、`shopRate`、`imPlugin`、`isImportDelivery`。
 * 它们是**页面装修配置**，不是"这家店是什么、谁在管、什么状态"，端给模型只是噪声。
 * **这一条是取舍，不是安全问题**，所以逐个点名写在这里，免得被读成"漏了"。
 * 要用的调用方按需提，别放开整个白名单——`smoke/read-base-sale.mjs` 每次都把这份差集打出来。
 *
 * ---------------------------------------------------------------------------------------
 * 三、体积：五条里三条是"无参数全量"，所以每个入口都有硬上限
 * ---------------------------------------------------------------------------------------
 *
 * 这五条接口**后端不接受任何查询参数**（`allArea` / `manufacturerInfoList` / `brandAllList`
 * 连分页都没有）。也就是说：**过滤只能在 SDK 侧做，网络上的 236 KB / 70 KB / 46 KB 省不掉。**
 * 这不是偷懒，是接口的现实；能省的是**进上下文的字节数**——所以：
 *
 * | 入口 | 返回条数上限 | 拉回来的字节（省不掉） |
 * | --- | --- | --- |
 * | `base-sale-area-search` / `-children` / `-describe` | 默认 50 / 上限 200 | **235,914 B**（3440 节点） |
 * | `base-sale-manufacturer-search` | 默认 20 / 上限 100 | **70,208 B**（711 条） |
 * | `base-sale-brand-search` | 默认 20 / 上限 100 | **46,533 B**（741 条） |
 *
 * 三个大件都**按实例内 TTL 缓存 + 单飞**：一辈子只拉一次，之后都走内存索引。
 * 于是"拉全量"这件事每 30 分钟最多发生一次，而不是每次调用发生一次。
 *
 * **长选项参数一律先要关键字**（conventions 第 11 条）：
 * 厂商 711 / 品牌 741 / 地区 3440 —— 与第一批的部门（1551）同一量级，所以同样**强制 `keyword`**。
 * 地区另有一条**不要关键字**的正路：`base-sale-area-children({ parentId: 0 })` 从根往下翻，
 * 每次只有一层（根是 34 个省）。这与第一批 `base-dept-children` 的形态一致。
 *
 * **没有 `listAll()`**，任何入口都没有。
 *
 * ---------------------------------------------------------------------------------------
 * 四、两个实测到的坑（都写进了参数描述与返回值）
 * ---------------------------------------------------------------------------------------
 *
 * 1. **地区节点的名称字段叫 `value`，不叫 `name`**。实测一条是
 *    `{"id":110000,"parentId":0,"value":"北京市","children":[…]}`。
 *    照 `base-dept-*`（那个是 `name`）的习惯写会**静默拿到 undefined**。
 *    本能力在归一化时把它映射成 `value` 原样保留 + 额外给 `pathNames`，不做改名。
 *
 * 2. **地区是四面树、且名称会重复**：`北京市(110000) → 北京市(110100) → 东城区(110101)`，
 *    最大深度 **3**（实测），3440 个节点里"北京市"出现两次。
 *    所以 `base-sale-area-search` 返回的每一条都带 `pathIds` / `pathNames`
 *    （`["北京市","北京市","东城区"]`）——只给 `value` 是**没法用**的。
 *
 * 另一件不是坑但要知道的：`base-sale-shop-info` 的 `shopArea` 实测是
 * `"110000,110100,110117"`（**逗号串的 id**）。把它翻成名字用 `base-sale-area-describe`——
 * 那是本族内部的一条依赖，也是这一族里唯一一处"能力依赖能力"。
 *
 * ---------------------------------------------------------------------------------------
 * 五、两个「发不发」的决定：`module-type` 不发、`_t` 不发（都做了实测对照）
 * ---------------------------------------------------------------------------------------
 *
 * **`module-type` 默认不发。** 五个页面路径都是合成的 `/base-data/*`，规则表全以 `/dashboard/`
 * 开头，所以 `resolveModuleType()` 一律返回 `null`（conventions 第 2 条：算不出就不发）。
 * `smoke/read-base-sale.mjs` 对**四个接口**（店铺 / 地区 / 待处理提示；厂商与品牌同族未测）
 * 各做了**交错四次**的对照（不带 → 带 11 → 不带 → 带 11），判据与 `read-base-shell.mjs` 相同：
 * 先确认基线自己稳不稳，再比带/不带。**实测结果：四个都是"基线稳 + 带/不带 data 完全相同"。**
 * ⚠️ 口径：这是"**本账号实测**不敏感"，不是"后端不读这个头"。需要收窄时由接线方通过
 * `BaseSaleOptions.moduleType` 显式给——SDK 不猜。
 *
 * **`_t` 不发。** `sale.js:22-27` 的请求拦截器给**每个 GET** 加 `_t=时间戳`（防缓存）。
 * 本能力刻意不加：它不改变返回内容，却会让**任何一层缓存都失效**——而那正是本族
 * （236 KB 的地区树、70 KB 的厂商表）最需要的东西。这条不是推测：
 * `smoke/read-base-sale.mjs` 的 F 段做了带 / 不带 `_t` 的对照，**实测 data 完全相同**。
 * 另外 `sale.js:38-41` 会把 `pageSize` 改名成 `limit`——本族五个接口一个都不传分页参数，
 * 所以那个别名在这里用不上（记在这里是为了别有人后来"顺手"加个 pageSize）。
 *
 * ---------------------------------------------------------------------------------------
 * 六、明确没做的（都是复核过之后的决定，不是漏掉）
 * ---------------------------------------------------------------------------------------
 *
 * - **`{MALL_ADMIN}/sys/crm/area/list?id=`（`docs/base-capabilities.md` §2.1 的 #19）** ——
 *   实测 **349,985 B / 34 个根**，与上面的销售地区 `allArea` **同为 34 个省**（同一份行政区划），
 *   体量却是 **1.48 倍**（多了 `children: null` 之外的字段）。多建一条同义词纯浪费。
 * - **`/adminmanage-api/system/dict-data/list-all-simple`（#18）** —— 实测
 *   **1,021,377 B / 5983 条**（调查记的是 954 KB，本轮量到 1.02 MB，比调查更大）。
 *   与第一批已覆盖的 `grouped-list` 内容高度重叠，不建。
 * - **`{FM}/getUser`（#2）、`{CRM}/vue/getUserInfo`（#3）** —— 不在本单的只读范围内：
 *   `product` 在 `fmtest.zhihuidanji.com`、`crm` 在 `biz-api-test.wodecorp.cn/admin-crm-api`，
 *   后者的 base 与 `sale` 同类但**本单没有实测过它的任何一条返回**。
 *   `docs/base-capabilities.md` 把 #2/#3 与 #14~#17 捆在一条"P0-0 跨网关前缀"上，
 *   而那条结论已被推翻（见该文顶部勘误），所以本单按"**没实测就不建**"处理。
 * - **`org/sensitive/info`（#7）** —— **这是一条安全判断，不是省事**：实测 206 B，
 *   返回 `{ id, mobile: "18002178521", isDel: 1, … }`。查源码，
 *   `app/portal/hooks/hr/useSensitiveAction.js:18-19` 的用法是
 *   `if (sensitive.state.isDel === 1) { 直接放行 } else { 弹验证框 }` ——
 *   也就是说 **`mobile` 是"敏感操作二次验证"用的那个手机号**。
 *   把它端给模型等于**把验证码那条路的号码告诉被验证方**：这是一个反特性，不是能力缺失。
 *   所以不建，并且理由是安全性的，不是优先级的。
 * - **`org/organization/getRoleOrganizationTree`（#13）** —— 本轮实测
 *   **596,663 B / 1547 个节点**，而第一批的 `base-dept-*`
 *   （`system/dept/list-all-simple`，**73,754 B / 1551 个节点**）**按名字是它的超集**：
 *   1547 个组织节点里"只在组织树、不在部门表"的有 **0 个**，
 *   "只在部门表、不在组织树"的只有 2 个（实为测试数据「测试」「测试的孩子」）。
 *   逐字节比较**为了同一份（其实更少的）数据多花 8 倍字节**，还多背一个
 *   `module-type` 敏感的缓存键——不建。（比对按**节点名**做的，不是 id；
 *   两者 id 口径不同这件事本单没有进一步追。见 `docs/base/销售域基础数据.md`。）
 *
 * 四件套的其它三件：`docs/base/销售域基础数据.md`；真实环境只读冒烟 `smoke/read-base-sale.mjs`；
 * 回归测试 `test/base-sale.test.ts`。**接线（注册进 `src/capabilities/index.ts` 与两个门面）
 * 由派单方统一做**，本文件不碰任何索引文件。
 */

import { SingleFlight } from '../session/single-flight.js'
import type { BaseDataRequest } from './base-dept-dict-permission.js'
import type { CapabilityDefinition } from './types.js'

// ---------------------------------------------------------------------------
// 合成页面上下文（与前三批同一个根，理由见 base-dept-dict-permission.ts）
// ---------------------------------------------------------------------------

/**
 * ⚠️ 下面这几个常量**必须写成单引号字符串字面量**，不能拼模板串——
 * `tools/generate/derive-aliases.mjs:183` 的正则 `const\s+(\w+)\s*=\s*'([^']*)'` 只认单引号。
 * 拼出来的话这些路径解析为 null，能力定义会被**静默跳过**，于是「目录扫到的」与
 * 「应用真正加载的」分叉——那正是 `test/aliases-derived.test.ts` 卡的事。
 */
export const BASE_SALE_CONTEXT_ROOT = '/base-data'
export const BASE_SALE_SHOP_PATH = '/base-data/sale-shop'
export const BASE_SALE_AREA_PATH = '/base-data/sale-area'
export const BASE_SALE_MANUFACTURER_PATH = '/base-data/sale-manufacturer'
export const BASE_SALE_BRAND_PATH = '/base-data/sale-brand'
export const BASE_SALE_HOME_TIP_PATH = '/base-data/sale-home-tip'

// ---------------------------------------------------------------------------
// 接口。**路径是相对 `sale` 实例 baseURL 的**（测试环境 = `…/admin-shop-api`）
// ---------------------------------------------------------------------------

export const SALE_SHOP_URL = '/admin/shop/getInfo'
export const SALE_AREA_URL = '/admin/area/allArea'
export const SALE_MANUFACTURER_URL = '/admin/categoryManufacturer/manufacturerInfoList'
export const SALE_BRAND_URL = '/admin/categoryBrand/brandAllList'
export const SALE_TRADE_TIP_URL = '/admin/trade/adjustTradeProcessTip'

/** 测试环境的 `VITE_SHOP_ADMIN_API`（`build/env/.env.build.test:21`）。只用于报错消息与文档 */
export const SALE_INSTANCE_ID = 'sale'
export const SALE_BASE_URL_ENV = 'VITE_SHOP_ADMIN_API'

// ---- 硬上限。理由见文件头第三节 ----
export const SALE_AREA_LIMIT_DEFAULT = 50
export const SALE_AREA_LIMIT_MAX = 200
export const SALE_MANUFACTURER_LIMIT_DEFAULT = 20
export const SALE_MANUFACTURER_LIMIT_MAX = 100
export const SALE_BRAND_LIMIT_DEFAULT = 20
export const SALE_BRAND_LIMIT_MAX = 100

/** 树的遍历保护：实测最大深度是 3，超过这个数说明数据坏了，宁可报错也不要静默截断 */
export const SALE_AREA_MAX_DEPTH_GUARD = 20

/** 未挂会话时，实例内缓存的存活时间。与 `DEFAULT_ABSOLUTE_TTL_MS` 同值，测试里钉死 */
export const BASE_SALE_CACHE_TTL_MS = 30 * 60 * 1000

// ---------------------------------------------------------------------------
// 归一化后的形状
// ---------------------------------------------------------------------------

/**
 * 店铺信息（**白名单视图**，见文件头第二节）。
 *
 * 没有出现在这个类型里的字段**一定不会被返回**——包括 `shopuserIdentity`（身份证号）、
 * `shopuserIdentityImg` / `ImgZ` / `ImgF`（证件照 URL）与 `mobile`（个人手机号）。
 */
export type ShopInfo = {
  shopId: string | null
  shopName: string | null
  /** 店铺全名（如「峪口禽业旗舰店」对应的全称） */
  shopAllName: string | null
  /** 实测 `store`（自营）/ `supplier`（供应商，在 `openType` 里） */
  shopType: string | null
  shopTypeName: string | null
  status: string | null
  sellerId: string | null
  /** 店铺使用人姓名（实测「张烜明」）。**保留**：这是"谁在管这家店"，不是联系方式 */
  shopuserName: string | null
  /** 店铺服务电话（公司级，实测 `01089965229`） */
  servicesTel: string | null
  email: string | null
  shopLogo: string | null
  shopAddr: string | null
  /** ⚠️ 实测是**逗号串的行政区划 id**（`"110000,110100,110117"`），不是名字。用 `base-sale-area-describe` 翻 */
  shopArea: string | null
  bulletin: string | null
  openTime: string | null
  closeTime: string | null
  closeReason: string | null
  openType: string | null
}

/** 地区树的一个节点（**扁平索引里的一条**，带从根到它的路径） */
export type AreaEntry = {
  id: number
  parentId: number
  /** ⚠️ 名称字段在原始响应里就叫 `value`（**不是 `name`**），见文件头第四节 */
  value: string
  /** 从根到本节点的 id 路径（含本节点） */
  pathIds: number[]
  /** 从根到本节点的名字路径（含本节点）。⚠️ 名字会重复（北京市/北京市/东城区） */
  pathNames: string[]
  /** 有没有下级（叶子节点的 `children` 实测是 `null`，不是空数组） */
  hasChildren: boolean
}

export type Manufacturer = {
  manufacturerId: number
  manufacturerName: string
}

export type Brand = {
  brandId: number
  brandName: string
  manufacturerId: number | null
}

/** 首页待处理订单提示。字段语义直读 `utils/router/sale.js:29-35` 的弹窗分支 */
export type SaleHomeTip = {
  /** 有未付款订单待处理（源码里 → `orderDealModal(10)`） */
  unpaidTip: boolean
  /** 有待发货订单待处理（源码里 → 仅当 `!unpaidTip` 时 `orderDealModal(20)`） */
  waitShipTip: boolean
}

/** 形状不认识时抛它：这是**数据/接线**问题，不是"没有数据" */
export class BaseSaleShapeError extends Error {
  override readonly name = 'BaseSaleShapeError'
  constructor (message: string) {
    super(message)
  }
}

/**
 * `sale` 实例的请求函数没有接线。
 *
 * 单独一个错误类型，是为了让这条失败**在消息里自带修法**——它不可能是数据问题，
 * 只可能是接线没配（见文件头第一节）。
 */
export class SaleNotWiredError extends Error {
  override readonly name = 'SaleNotWiredError'
  constructor (capabilityId: string) {
    // 整段写进 message（不用 `Error` 的 `{ cause }`）：这个错误的**全部价值就是自带修法**，
    // 调用方在日志里看到的那一行必须能直接照做。测试里逐条钉了 message 里的关键词。
    super(
      `${capabilityId} 需要 sale 实例的请求函数，但创建本能力时没有传 saleRequest。` +
        `本族五条接口走的是 ${SALE_INSTANCE_ID} 实例（baseURL = ${SALE_BASE_URL_ENV}，` +
        '测试环境是 https://biz-api-test.wodecorp.cn/admin-shop-api），与 platform 同 host、不同前缀。' +
        'conventions 第 27 条要求这种 base 由调用方显式给，SDK 不拿默认 baseUrl 去凑' +
        '（凑错的失败方式只是 404 或字段不同的 200，静默且难查）。' +
        `接法：给 createBaseSale({ saleRequest }) 传一个 baseURL 指向 ${SALE_BASE_URL_ENV} 的请求函数` +
        `（或 createPageCall 的 options.baseUrls['${SALE_INSTANCE_ID}']）。`,
    )
  }
}

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

const AREA_LOOKUP = { capabilityId: 'base-sale-area-search', keywordParam: 'keyword' } as const

export const baseSaleCapabilities: CapabilityDefinition[] = [
  // ---- 店铺 ----
  {
    id: 'base-sale-shop-info',
    title: '当前销售店铺的信息（基础能力，白名单字段，身份证号已裁）',
    pagePath: BASE_SALE_SHOP_PATH,
    write: false,
    params: [],
  },

  // ---- 地区 ----
  {
    id: 'base-sale-area-search',
    title: '按名称关键字搜行政区划（基础能力，3440 个节点 / 后端无过滤参数）',
    pagePath: BASE_SALE_AREA_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          '行政区划名称关键字（不区分大小写，如「东城」「朝阳」）。候选是**全量 3440 个节点**' +
          '（实测：34 个省 / 最大深度 3），属于长选项参数，必须先给关键字（设计 D6 / H35）。' +
          '⚠️ 一条要如实说的代价：这个接口**不接受任何查询参数**，所以关键字是 **SDK 本地过滤**——' +
          '每次调用仍会拉回 235,914 B 的全量，只是不进上下文（拉了之后按 TTL 缓存）',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${SALE_AREA_LIMIT_DEFAULT}，上限 ${SALE_AREA_LIMIT_MAX}`,
      },
    ],
  },
  {
    id: 'base-sale-area-children',
    title: '列某个行政区划的直接下级（基础能力，从省往下翻）',
    pagePath: BASE_SALE_AREA_PATH,
    write: false,
    params: [
      {
        name: 'parentId',
        kind: 'search',
        required: true,
        description:
          '上级 id。**传 0 取根**（实测根有 34 个，即省级；根的 `parentId` 就是 0，不是 null）。' +
          '要按名字找 id 走 base-sale-area-search',
        lookup: AREA_LOOKUP,
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${SALE_AREA_LIMIT_DEFAULT}，上限 ${SALE_AREA_LIMIT_MAX}`,
      },
    ],
  },
  {
    id: 'base-sale-area-describe',
    title: '把行政区划 id 串翻成名字（基础能力，给 shopArea 用）',
    pagePath: BASE_SALE_AREA_PATH,
    write: false,
    params: [
      {
        name: 'ids',
        kind: 'text',
        required: true,
        description:
          '一个或多个行政区划 id，用英文逗号分隔（也接受数组）。' +
          '**这就是 base-sale-shop-info 的 `shopArea` 的格式**（实测 `"110000,110100,110117"`）——' +
          '两者直接对接。未知 id **不会报错**，会在返回的 `unknown` 里逐个列出（不静默丢掉）',
      },
    ],
  },

  // ---- 厂商 / 品牌 ----
  {
    id: 'base-sale-manufacturer-search',
    title: '按名称关键字搜厂商（基础能力，711 条 / 后端无过滤参数）',
    pagePath: BASE_SALE_MANUFACTURER_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          '厂商名称关键字（不区分大小写）。候选 **711 条**（实测），属长选项参数，必须先给关键字（设计 D6 / H35）。' +
          '⚠️ 关键字是 **SDK 本地过滤**：后端不接受参数，每次调用仍会拉回 70,208 B（之后按 TTL 缓存）',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${SALE_MANUFACTURER_LIMIT_DEFAULT}，上限 ${SALE_MANUFACTURER_LIMIT_MAX}`,
      },
    ],
  },
  {
    id: 'base-sale-brand-search',
    title: '按名称关键字搜品牌（基础能力，741 条 / 后端无过滤参数）',
    pagePath: BASE_SALE_BRAND_PATH,
    write: false,
    params: [
      {
        name: 'keyword',
        kind: 'search',
        required: true,
        description:
          '品牌名称关键字（不区分大小写）。候选 **741 条**（实测），属长选项参数，必须先给关键字（设计 D6 / H35）。' +
          '⚠️ 同样是 **SDK 本地过滤**：后端不接受参数，每次调用仍会拉回 46,533 B（之后按 TTL 缓存）',
      },
      {
        name: 'manufacturerId',
        kind: 'number',
        required: false,
        description:
          '再按所属厂商 id 收窄（本地过滤）。用 base-sale-manufacturer-search 拿 id。' +
          '⚠️ 实测 741 条品牌里**每一条都带 `manufacturerId`**，但厂商接口的 `brandList` 字段实测**全是 null**，' +
          '所以「厂商 → 品牌」这个方向只能靠这张品牌表，不能靠厂商表',
      },
      {
        name: 'limit',
        kind: 'number',
        required: false,
        description: `最多返回几条，默认 ${SALE_BRAND_LIMIT_DEFAULT}，上限 ${SALE_BRAND_LIMIT_MAX}`,
      },
    ],
  },

  // ---- 首页待处理提示 ----
  {
    id: 'base-sale-home-tip',
    title: '首页待处理订单提示：有未付款 / 待发货吗（基础能力）',
    pagePath: BASE_SALE_HOME_TIP_PATH,
    write: false,
    params: [],
  },
]

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export type BaseSaleOptions = {
  /**
   * **`sale` 实例**的请求函数（baseURL = `VITE_SHOP_ADMIN_API`）。
   *
   * 不传则本族的每个方法都会抛 `SaleNotWiredError`（**不是**静默退回默认 baseURL）——
   * 见文件头第一节与 conventions 第 27 条。
   */
  saleRequest?: BaseDataRequest | null
  /** 这个头默认**不发**（合成页面路径推不出 module-type，conventions 第 2 条） */
  moduleType?: number
  /** 实例内缓存的 TTL。默认 `BASE_SALE_CACHE_TTL_MS`（30 分钟） */
  cacheTtlMs?: number
  /** 注入时钟，测试用（conventions 第 22 条：TTL 不用真实 sleep 测） */
  now?: () => number
}

function clampLimit (value: number | undefined, fallback: number, max: number): number {
  const raw = value === undefined || value === null ? fallback : Math.trunc(Number(value))
  if (!Number.isFinite(raw)) return fallback
  return Math.min(Math.max(1, raw), max)
}

const asString = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value)

const asNumberOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const asFlag = (value: unknown): boolean => value === 1 || value === true || value === '1'

/**
 * 店铺 → 白名单视图（见文件头第二节）。
 *
 * **这里是 `shopuserIdentity` / `shopuserIdentityImg*` / `mobile` 唯一的出口关卡。**
 * 少走一次就是一次身份证号外流，而且**不会有任何测试之外的症状**——
 * 所以 `test/base-sale.test.ts` 里拿真机形状的夹具专门卡了这件事。
 */
export function normalizeShopInfo (payload: unknown): ShopInfo {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BaseSaleShapeError(
      `${SALE_SHOP_URL} 期望返回一个对象，收到 ` +
        `${payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload}`,
    )
  }
  const raw = payload as Record<string, unknown>
  if (raw.shopId === undefined || raw.shopId === null) {
    throw new BaseSaleShapeError(`${SALE_SHOP_URL} 的返回里没有 shopId —— 多半不是店铺信息`)
  }
  return {
    shopId: asString(raw.shopId),
    shopName: asString(raw.shopName),
    shopAllName: asString(raw.shopAllName),
    shopType: asString(raw.shopType),
    shopTypeName: asString(raw.shopTypeName),
    status: asString(raw.status),
    sellerId: asString(raw.sellerId),
    shopuserName: asString(raw.shopuserName),
    servicesTel: asString(raw.servicesTel),
    email: asString(raw.email),
    shopLogo: asString(raw.shopLogo),
    shopAddr: asString(raw.shopAddr),
    shopArea: asString(raw.shopArea),
    bulletin: asString(raw.bulletin),
    openTime: asString(raw.openTime),
    closeTime: asString(raw.closeTime),
    closeReason: asString(raw.closeReason),
    openType: asString(raw.openType),
  }
}

/**
 * 把地区树摊成 `id → AreaEntry` 的索引（带路径）。
 *
 * 两处**必须报错而不是静默**的地方：
 * 1. **id 重复** —— `Map.set` 会静默丢掉后一条，于是"某个区县查不到"变成一个查不出的幽灵；
 * 2. **深度超过 `SALE_AREA_MAX_DEPTH_GUARD`** —— 数据出环时递归会栈溢出，那是崩溃不是报错。
 */
export function indexAreaTree (payload: unknown): Map<number, AreaEntry> {
  if (!Array.isArray(payload)) {
    throw new BaseSaleShapeError(
      `${SALE_AREA_URL} 期望返回节点数组，收到 ${payload === null ? 'null' : typeof payload}`,
    )
  }
  const index = new Map<number, AreaEntry>()

  const walk = (nodes: unknown[], parentId: number, pathIds: number[], pathNames: string[], depth: number): void => {
    if (depth > SALE_AREA_MAX_DEPTH_GUARD) {
      throw new BaseSaleShapeError(
        `${SALE_AREA_URL} 的树深度超过 ${SALE_AREA_MAX_DEPTH_GUARD}（实测真机是 3）——数据里有环或结构变了`,
      )
    }
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') continue
      const raw = node as Record<string, unknown>
      const id = asNumberOrNull(raw.id)
      if (id === null) {
        throw new BaseSaleShapeError(`${SALE_AREA_URL} 的节点里有一个没有数字 id：${JSON.stringify(raw).slice(0, 120)}`)
      }
      if (index.has(id)) {
        throw new BaseSaleShapeError(
          `${SALE_AREA_URL} 里 id=${id} 出现了两次 —— 索引会静默丢掉后一条，所以这里直接报错`,
        )
      }
      const children = Array.isArray(raw.children) ? raw.children : null
      const name = asString(raw.value) ?? ''
      const nextIds = [...pathIds, id]
      const nextNames = [...pathNames, name]
      index.set(id, {
        id,
        parentId: asNumberOrNull(raw.parentId) ?? parentId,
        value: name,
        pathIds: nextIds,
        pathNames: nextNames,
        hasChildren: children !== null && children.length > 0,
      })
      if (children !== null) walk(children, id, nextIds, nextNames, depth + 1)
    }
  }

  walk(payload, 0, [], [], 1)
  return index
}

/** 厂商列表 → 形状。实测 711 条只有 `manufacturerId` / `manufacturerName` / `brandList`（恒 null） */
function normalizeManufacturers (payload: unknown): Manufacturer[] {
  if (!Array.isArray(payload)) {
    throw new BaseSaleShapeError(
      `${SALE_MANUFACTURER_URL} 期望返回数组，收到 ${payload === null ? 'null' : typeof payload}`,
    )
  }
  return payload
    .map((item) => {
      const raw = (item ?? {}) as Record<string, unknown>
      const id = asNumberOrNull(raw.manufacturerId)
      if (id === null) return null
      return { manufacturerId: id, manufacturerName: asString(raw.manufacturerName) ?? '' }
    })
    .filter((item): item is Manufacturer => item !== null)
}

function normalizeBrands (payload: unknown): Brand[] {
  if (!Array.isArray(payload)) {
    throw new BaseSaleShapeError(
      `${SALE_BRAND_URL} 期望返回数组，收到 ${payload === null ? 'null' : typeof payload}`,
    )
  }
  return payload
    .map((item) => {
      const raw = (item ?? {}) as Record<string, unknown>
      const id = asNumberOrNull(raw.brandId)
      if (id === null) return null
      return {
        brandId: id,
        brandName: asString(raw.brandName) ?? '',
        manufacturerId: asNumberOrNull(raw.manufacturerId),
      }
    })
    .filter((item): item is Brand => item !== null)
}

/** `"110000,110100"` 或 `[110000, 110100]` 或 `110000` → `[110000, 110100]`（非法项直接拒绝） */
export function parseAreaIds (value: unknown): number[] {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  const ids: number[] = []
  for (const item of raw) {
    const text = String(item).trim()
    if (text === '') continue
    const num = Number(text)
    if (!Number.isFinite(num)) {
      throw new BaseSaleShapeError(
        `行政区划 id 必须是数字，收到 ${JSON.stringify(item)}。` +
          '（shopArea 的格式是逗号串，如 "110000,110100,110117"）',
      )
    }
    ids.push(Math.trunc(num))
  }
  if (ids.length === 0) {
    throw new BaseSaleShapeError('行政区划 id 列表是空的——至少给一个（shopArea 可能是 null，那表示没设地区）')
  }
  return ids
}

/**
 * 造这批销售域基础能力的实现。
 *
 * ⚠️ **必须传 `saleRequest`**（baseURL 指向 `VITE_SHOP_ADMIN_API`），否则每个方法都抛
 * `SaleNotWiredError`。见文件头第一节。
 */
export function createBaseSale (options: BaseSaleOptions) {
  const saleRequest = options.saleRequest ?? null
  const ttlMs = options.cacheTtlMs ?? BASE_SALE_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const moduleType = options.moduleType

  const slices = new Map<string, { source: unknown; index: unknown; at: number }>()
  const flight = new SingleFlight<unknown>()
  let cacheGeneration = 0

  /** sale 请求 + moduleType 注入（默认不发）。没接线就在这里失败，消息自带修法 */
  const send = <T>(capabilityId: string, config: { url: string; method: 'get'; params?: unknown }): Promise<T> => {
    if (saleRequest === null) {
      return Promise.reject(new SaleNotWiredError(capabilityId))
    }
    return saleRequest<T>(moduleType === undefined ? config : { ...config, moduleType })
  }

  async function loadSlice<T> (
    sliceKey: string,
    fetchPayload: () => Promise<unknown>,
    build: (payload: unknown) => T,
  ): Promise<T> {
    const hit = slices.get(sliceKey)
    if (hit && now() - hit.at < ttlMs) {
      return hit.index as T
    }
    const generation = cacheGeneration
    const source = await flight.run(sliceKey, fetchPayload)
    if (hit && hit.source === source) {
      hit.at = now()
      return hit.index as T
    }
    const index = build(source)
    if (generation === cacheGeneration) {
      slices.set(sliceKey, { source, index, at: now() })
    }
    return index
  }

    /**
   * 出口一律交出**新建的对象**。
   *
   * 直接给缓存里那一份的话，调用方随手改一个 `entry.value` 或 `entry.pathIds.push(...)`
   * 就把 3440 个节点的索引污染了，而下一个调用方会拿到改过的数据——那种错查起来极其费劲。
   * `pathIds` / `pathNames` 是数组，浅拷对象不够，必须连数组一起拷。
   */
  const copyArea = (entry: AreaEntry): AreaEntry => ({
    ...entry,
    pathIds: [...entry.pathIds],
    pathNames: [...entry.pathNames],
  })

  /** 地区树索引（3440 节点 / 235,914 B，一辈子拉一次，之后都在内存里） */
  const loadAreaIndex = (): Promise<Map<number, AreaEntry>> =>
    loadSlice(
      'sale-area',
      () => send<unknown>('base-sale-area-search', { url: SALE_AREA_URL, method: 'get' }),
      indexAreaTree,
    )

  const loadManufacturers = (): Promise<Manufacturer[]> =>
    loadSlice(
      'sale-manufacturer',
      () => send<unknown>('base-sale-manufacturer-search', { url: SALE_MANUFACTURER_URL, method: 'get' }),
      normalizeManufacturers,
    )

  const loadBrands = (): Promise<Brand[]> =>
    loadSlice(
      'sale-brand',
      () => send<unknown>('base-sale-brand-search', { url: SALE_BRAND_URL, method: 'get' }),
      normalizeBrands,
    )

  return {
    /** 丢掉实例内缓存。基础数据变了、或要强制拿最新时用 */
    invalidate (slice?: 'sale-shop' | 'sale-area' | 'sale-manufacturer' | 'sale-brand'): void {
      cacheGeneration += 1
      if (slice === undefined) {
        slices.clear()
        flight.clear()
        return
      }
      slices.delete(slice)
      flight.forget(slice)
    },

    /**
     * 当前销售店铺的信息。**只读**。
     *
     * 返回的是白名单视图（`ShopInfo`）：原始响应里的 `shopuserIdentity`（实测是 18 位身份证号）、
     * `shopuserIdentityImg` / `ImgZ` / `ImgF`（证件照 URL）与 `mobile`（个人手机号）
     * **一定不在返回值里**。
     */
    async getShopInfo (): Promise<ShopInfo> {
      const payload = await send<unknown>('base-sale-shop-info', { url: SALE_SHOP_URL, method: 'get' })
      return normalizeShopInfo(payload)
    },

    /**
     * 按名称关键字搜行政区划。**只读**。
     *
     * `keyword` **必填**（3440 个节点属长选项参数，conventions 第 11 条）。
     * 关键字是 **SDK 本地过滤**——后端这个接口不接受任何参数（见文件头第三节）。
     */
    async searchAreas (query: { keyword: string; limit?: number }): Promise<{
      areas: AreaEntry[]
      total: number
      matched: number
      truncated: boolean
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') {
        return Promise.reject(
          new Error(
            'searchAreas 的 keyword 必填：行政区划候选是**全量 3440 个节点**（实测 34 个省 / 深度 3），' +
              '属于长选项参数，不允许无关键字全量拉取（设计 D6 / H35）。' +
              '要从根往下翻请用 listAreaChildren({ parentId: 0 })（那一层只有 34 个省）。',
          ),
        )
      }
      const limit = clampLimit(query?.limit, SALE_AREA_LIMIT_DEFAULT, SALE_AREA_LIMIT_MAX)
      const index = await loadAreaIndex()
      const all = [...index.values()]
      const hit = all.filter((entry) => entry.value.toLowerCase().includes(keyword))
      return {
        areas: hit.slice(0, limit).map(copyArea),
        total: all.length,
        matched: hit.length,
        truncated: hit.length > limit,
      }
    },

    /**
     * 列某个行政区划的直接下级。**只读**。
     *
     * `parentId` 传 0 取根（34 个省）。返回的每一条都带 `hasChildren`，
     * 所以"往下钻"这件事不需要额外请求。
     */
    async listAreaChildren (query: { parentId: number | string; limit?: number }): Promise<{
      parentId: number
      children: AreaEntry[]
      matched: number
      truncated: boolean
      /** 传进来的 parentId 在树里不存在（**不是**"它没有下级"） */
      parentFound: boolean
    }> {
      const raw = query?.parentId
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        return Promise.reject(
          new Error('listAreaChildren 的 parentId 必填。**传 0 取根**（实测根有 34 个，即省级）'),
        )
      }
      const parentId = Math.trunc(Number(raw))
      if (!Number.isFinite(parentId)) {
        return Promise.reject(
          new Error(`listAreaChildren 的 parentId 必须是数字，收到 ${JSON.stringify(raw)}；传 0 取根`),
        )
      }
      const limit = clampLimit(query?.limit, SALE_AREA_LIMIT_DEFAULT, SALE_AREA_LIMIT_MAX)
      const index = await loadAreaIndex()
      const all = [...index.values()].filter((entry) => entry.parentId === parentId)
      return {
        parentId,
        children: all.slice(0, limit).map(copyArea),
        matched: all.length,
        truncated: all.length > limit,
        parentFound: parentId === 0 || index.has(parentId),
      }
    },

    /**
     * 把行政区划 id 串翻成名字。**只读**。
     *
     * 直接对接 `base-sale-shop-info` 的 `shopArea`（实测 `"110000,110100,110117"`）。
     * 未知 id **不报错**，但会在 `unknown` 里逐个列出——**不静默丢掉**：
     * "翻不出来"和"这个地区被删了"是两件事，调用方要能分辨。
     */
    async describeAreas (query: { ids: string | number | Array<string | number> }): Promise<{
      areas: AreaEntry[]
      unknown: number[]
      /**
       * **最深的那个节点**的完整路径，用 `/` 连起来，如 `北京市/北京市/平谷区`。
       *
       * 为什么是"最深的一个"而不是把每个节点的路径拼起来：`shopArea` 的 ids 是
       * **从省到区的一条链**（实测 `"110000,110100,110117"`），链上每一段都是下一段的前缀，
       * 拼起来会得到 `北京市/北京市/北京市/北京市/平谷区` 那种重复串。
       * 取最深那个 = 这条链指向的实际地区。各级名字请用 `areas[i].pathNames`。
       */
      path: string
    }> {
      const ids = parseAreaIds(query?.ids)
      const index = await loadAreaIndex()
      const areas: AreaEntry[] = []
      const unknown: number[] = []
      for (const id of ids) {
        const entry = index.get(id)
        if (entry === undefined) unknown.push(id)
        else areas.push(copyArea(entry))
      }
      const deepest = areas.reduce<AreaEntry | null>(
        (best, entry) => (best === null || entry.pathIds.length > best.pathIds.length ? entry : best),
        null,
      )
      return {
        areas,
        unknown,
        path: deepest === null ? '' : deepest.pathNames.join('/'),
      }
    },

    /**
     * 按名称关键字搜厂商。**只读**。
     *
     * `keyword` **必填**（711 条属长选项参数）。关键字是 **SDK 本地过滤**：后端不接受参数，
     * 每次调用仍会拉回 70,208 B（之后按 TTL 缓存）。
     */
    async searchManufacturers (query: { keyword: string; limit?: number }): Promise<{
      manufacturers: Manufacturer[]
      total: number
      matched: number
      truncated: boolean
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') {
        return Promise.reject(
          new Error(
            'searchManufacturers 的 keyword 必填：厂商候选 **711 条**（实测），属于长选项参数，' +
              '必须先给关键字（设计 D6 / H35）。⚠️ 后端这个接口不接受任何过滤参数，' +
              '所以关键字是 SDK 本地过滤——省下的是上下文，不是网络字节。',
          ),
        )
      }
      const limit = clampLimit(query?.limit, SALE_MANUFACTURER_LIMIT_DEFAULT, SALE_MANUFACTURER_LIMIT_MAX)
      const all = await loadManufacturers()
      const hit = all.filter((item) => item.manufacturerName.toLowerCase().includes(keyword))
      return {
        manufacturers: hit.slice(0, limit).map((item) => ({ ...item })),
        total: all.length,
        matched: hit.length,
        truncated: hit.length > limit,
      }
    },

    /**
     * 按名称关键字搜品牌。**只读**。
     *
     * `keyword` **必填**（741 条属长选项参数）。可选 `manufacturerId` 再收窄（也是本地过滤）。
     */
    async searchBrands (query: { keyword: string; manufacturerId?: number; limit?: number }): Promise<{
      brands: Brand[]
      total: number
      matched: number
      truncated: boolean
    }> {
      const keyword = typeof query?.keyword === 'string' ? query.keyword.trim().toLowerCase() : ''
      if (keyword === '') {
        return Promise.reject(
          new Error(
            'searchBrands 的 keyword 必填：品牌候选 **741 条**（实测），属于长选项参数，' +
              '必须先给关键字（设计 D6 / H35）。⚠️ 后端这个接口不接受任何过滤参数，' +
              '所以关键字是 SDK 本地过滤。',
          ),
        )
      }
      const limit = clampLimit(query?.limit, SALE_BRAND_LIMIT_DEFAULT, SALE_BRAND_LIMIT_MAX)
      const wantedManufacturer = asNumberOrNull(query?.manufacturerId)
      const all = await loadBrands()
      const hit = all.filter(
        (item) =>
          item.brandName.toLowerCase().includes(keyword) &&
          (wantedManufacturer === null || item.manufacturerId === wantedManufacturer),
      )
      return {
        brands: hit.slice(0, limit).map((item) => ({ ...item })),
        total: all.length,
        matched: hit.length,
        truncated: hit.length > limit,
      }
    },

    /**
     * 首页待处理订单提示。**只读**。
     *
     * 字段语义直读 `app/portal/utils/router/sale.js:29-35`：`unpaidTip` → 未付款订单弹窗，
     * 且**只有 `!unpaidTip && waitShipTip` 才弹待发货**（即两者同时为真时，未付款优先）。
     * ⚠️ Portal 只在 `/dashboard/home` 打这一条；无头下没有"落地页"，由调用方自己判断该不该问。
     */
    async getHomeTip (): Promise<SaleHomeTip> {
      const payload = await send<unknown>('base-sale-home-tip', { url: SALE_TRADE_TIP_URL, method: 'get' })
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new BaseSaleShapeError(
          `${SALE_TRADE_TIP_URL} 期望返回一个对象，收到 ` +
            `${payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload}`,
        )
      }
      const raw = payload as Record<string, unknown>
      return { unpaidTip: asFlag(raw.unpaidTip), waitShipTip: asFlag(raw.waitShipTip) }
    },
  }
}

export type BaseSaleCapability = ReturnType<typeof createBaseSale>
