# `src/context/` —— 页面上下文的两个推导

| 文件 | 推导什么 | 入口 |
| --- | --- | --- |
| `module-type.ts` | 这次请求的 `module-type` 头该怎么填 | `resolveModuleType(pagePath)` |
| `http-instance.ts` | 这次请求走哪个 axios 实例（因而打到哪个 baseURL、补不补前缀、分页参数叫什么、发哪些头） | `resolveHttpInstance({ pagePath, declared })` |

两份推导的口径是同一套：都用 `normalizeMenuEntryPath()` 把详情页归回它所属的列表页再查表。

**两者「算不出」时的行为刻意相反**：`module-type` 算不出就不发这个头（D34，因为浏览器同样不发，是忠实）；http 实例算不出则**拒绝发请求**（走错实例 = 打到错的 URL，静默且难查）。

---

## §1 Portal 前端到底有几个 axios 实例

`app/portal/utils/http/` 下 **16 个文件、17 个实例**（`zhdj-cms.js` 一个文件里 `createHttp` 被调两次、导出两个绑定：`http` 与 `httpLay`，`zhdj-cms.js:106-107`）。

**「一个实例」的单位是导出的绑定，不是文件**——按文件建表会把 `http` 和 `httpLay` 混成一个。

另有一个 `app/portal/utils/sale/code-serive.js:3` 的 `axios.create()`（验证券码图片，`responseType: 'blob'`）。它在 `app/portal` 下**一个 import 都没有**，是死代码，不进表。

### 1a. 画像表（源码静态复核）

baseURL 一列给的是**测试环境**（`build/env/.env.build.test`）的取值，用来对照浏览器基准。

| id | 定义位置 | baseURL env（测试环境取值） | 补前缀 | 分页参数改名 | 请求头形态 | GET params 序列化 | 响应包络 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `platform` | `utils/http/platform.js:8-12` | `VITE_ZHDJ_PLATFORM_API` = `https://biz-api-test.wodecorp.cn` | **补 `/admin-api`** | 否 | `generateHttpHeaders({ moduleType })` | **qs 拼进 url** | `portal-standard` |
| `sale` | `utils/http/sale.js:8-12` | `VITE_SHOP_ADMIN_API` = `…/admin-shop-api` | 否 | **`pageSize` → `limit`** | `generateHttpHeaders()` | axios 默认 | `portal-standard` |
| `product` | `utils/http/product.js:9-12` | `VITE_FM_API` = `https://fmtest.zhihuidanji.com/flockSimu` | 否 | 否 | `generateHttpHeaders()` + `devicetype: PC` | axios 默认 | `portal-standard` |
| `product-no-token` | `utils/http/product-no-token.js:9-12` | `VITE_FM_API`（同上） | 否 | 否 | `generateHttpHeaders()` | axios 默认 | `portal-standard` |
| `crm` | `utils/http/crm.js:8-12` | `VITE_CRM_API` = `…/admin-crm-api` | 否 | 否 | `generateHttpHeaders()` | axios 默认 | `portal-standard` |
| `platform-mall-admin` | `utils/http/platform-mall-admin.js:10-14` | `VITE_MALL_ADMIN_API` = `…/mall-manage-api` | 否 | 否 | `generateHttpHeaders()` | axios 默认 | `portal-standard` |
| `platform-mall-mes` | `utils/http/platform-mall-mes.js:6-9` | `VITE_MES_API` = `https://ptmtest.wodecorp.cn/PoultryMes` | 否 | 否 | 手写（见 §1c） | axios 默认 | `portal-standard` |
| `mall-app` | `utils/http/mall-app.js:8-11` | `VITE_MALL_APP_API` = `…/mall-api` | 否 | 否 | `generateHttpHeaders()` | axios 默认 | **`code === 0`** |
| `smart-layer-admin` | `utils/http/smart-layer-admin.js:9-12` | `VITE_SMART_LAYER_ADMIN_API` = `https://smarterlayeradmintest.zhihuidanji.com/admin` | 否 | 否 | 手写 | axios 默认 | **`code === 200`** |
| `smart-layer-app` | `utils/http/smart-layer-app.js:9-12` | `VITE_SMART_LAYER_APP_API` = `https://smarterlayerapptest.zhihuidanji.com` | 否 | 否 | 手写 | axios 默认 | **`code === 200`** |
| `zhdj-admin` | `utils/http/zhdj-admin.js:9-12,15-17` | `VITE_SMART_LAYER_ADMIN_API` | 否 | 否 | 手写 | axios 默认 | `ret === SUCCESS`，但**返回整个包络** |
| `zhdj-app` | `utils/http/zhdj-app.js:9-12` | `VITE_ZHDJ_CMS_APP_API` = `https://smarterlayerapptest.zhihuidanji.com` | 否 | 否 | custom（token 默认**不进** header） | axios 默认 | `ret === SUCCESS` → `data.data` |
| `zhdj-app-lay` | `utils/http/zhdj-app-lay.js:11-22` | **无 baseURL**，`getAppUrlLay` 把 env 拼进 url | 补 `.lay` 后缀 | 否 | custom | axios 默认 | `ret === SUCCESS` |
| `zhdj-cms` | `utils/http/zhdj-cms.js:11-18,107` | `VITE_SMART_LAYER_ADMIN_API` | 否 | 否 | custom | axios 默认 | `ret === SUCCESS` |
| `zhdj-cms-lay` | `utils/http/zhdj-cms.js:11-18,106` | `VITE_SMART_LAYER_ADMIN_API` | 补 `.lay` 后缀 | 否 | custom | axios 默认 | `ret === SUCCESS` |
| `zhdj-sms` | `utils/http/zhdj-sms.js:9-12` | `VITE_ZHDJ_CMS_API` = `https://smarterlayeradmintest.zhihuidanji.com/admin` | 否 | 否 | 手写 | axios 默认 | **`code === 200`** |
| `build-version` | `utils/http/build-version.js:3-5` | **无 baseURL**，`timeout: 5000` | 否 | 否 | 无 | axios 默认 | 无（裸响应） |

**SDK 实现了哪些**：17 个实例均有请求侧画像；响应处理已有 `portal-standard`、`smart-layer`、`zhdj-sms`、`mall-app` 四档。画像存在不代表所有分支均已复刻，当前边界见 §1d / §3。

### 1b. 四种差异，逐条

**差异一：baseURL。** 5 个实例与默认实例**同 host、不同前缀**：

| 实例 | 测试环境 baseURL | 相对 platform 的差异 |
| --- | --- | --- |
| `platform` | `https://biz-api-test.wodecorp.cn` | 基准 |
| `sale` | `https://biz-api-test.wodecorp.cn/admin-shop-api` | 同 host，前缀 `/admin-shop-api` |
| `platform-mall-admin` | `https://biz-api-test.wodecorp.cn/mall-manage-api` | 同 host，前缀 `/mall-manage-api` |
| `mall-app` | `https://biz-api-test.wodecorp.cn/mall-api` | 同 host，前缀 `/mall-api` |
| `crm` | `https://biz-api-test.wodecorp.cn/admin-crm-api` | 同 host，前缀 `/admin-crm-api` |
| `product` / `product-no-token` | `https://fmtest.zhihuidanji.com/flockSimu` | **不同 host** |
| `platform-mall-mes` | `https://ptmtest.wodecorp.cn/PoultryMes` | **不同 host** |
| `smart-layer-*` / `zhdj-*` | `https://smarterlayer*test.zhihuidanji.com[/admin]` | **不同 host** |

生产环境同理（`.env.build.prod`：`biz-api.wodecorp.cn` 一组前缀、`fmu.wodecorp.cn`、`dhrapi.wodecorp.cn`、`ptm.wodecorp.cn`、`smart.wodecorp.cn`、`smartapi.wodecorp.cn`）。

> **这 5 个同 host 不同前缀的实例正是被那个「范围决策」挡住的部分**（16 页打到 `VITE_SHOP_ADMIN_API`）。SDK 不替这个决策做主：它只要求调用方显式给出 baseURL，否则拒绝发请求。

**差异二：补前缀。** 17 个实例里**只有 `platform.js` 有**这个拦截器：

```js
// app/portal/utils/http/platform.js:18-20
if (config.url.startsWith('/') && !config.url.startsWith('/admin-api')
    && !config.url.startsWith('/adminmanage-api') && !config.url.startsWith('/mall-manage-api')) {
  config.url = `/admin-api${config.url}`
}
```

三个边界条件，缺一不可：

1. **必须以前导 `/` 开头**。页面里漏写斜杠的相对路径（实测存在这类页面）**原样发出**，被 axios 当成相对路径拼到 baseURL 后面。
2. **命中三个 passthrough 之一就不补**。`/adminmanage-api` 与 `/mall-manage-api` 是**绝对路径**，靠这条透传才能到达；`/admin-api` 是防重复补。
3. 判断发生在 **baseURL 拼接之前**，比的是 `config.url` 原文。

`sale.js` 确认**没有**这个拦截器（`utils/http/sale.js:14-57` 的请求拦截器里没有任何 `config.url` 赋值）。唯一有浏览器实测的是 `/dashboard/sale/customer-service/after-sale/list`：真实请求 `https://biz-api-test.wodecorp.cn/admin-shop-api/admin/aftersales/page`，**没有** `/admin-api`。

**差异三：分页参数名。**

- **全局默认是 `pageSize`**，不是 `limit`：`common/libs/renren/config.js:11` 写的是 `limit`，但 `app/portal/main.js:42-48` 的 `setRenrenConfig({ fieldNamePageSize: 'pageSize' })` 把它覆写掉了。列表页写进请求的是 `pageSize`。
- **只有 `sale.js` 在拦截器里改名**：`sale.js:38-41` 改 GET 的 `params`、`48-51` 改 POST 的 `data`，都是「原名存在且不是 `undefined` → `limit = pageSize` → 删 `pageSize`」。
- 页面还能**逐页**覆盖 `fieldNamePageSize`（实测 `/dashboard/flow/old/model/list` 覆写成 `limit`，浏览器基准里是真的 `limit=20`），但那走的是 `platform.js`，与实例无关。

所以「分页参数叫什么」= **页面的 `fieldNamePageSize`（默认 `pageSize`）** × **实例要不要改名（只有 `sale` 改名）**。

**差异四：请求头。** 三种形态，**不是同一个头换了个值，而是发的头不一样**：

| 形态 | 具体头 | 用在哪些实例 |
| --- | --- | --- |
| `generateHttpHeaders`（`app/portal/utils/system.js:813-836`） | `tenant-id`、`token`、`module-type`、`Accept-Language` | `platform`（多传 `config.moduleType` 作覆盖）、`sale`、`product`、`product-no-token`、`crm`、`platform-mall-admin`、`mall-app` |
| 手写 `minimal` | **只有** `token`、`Accept-Language` | `platform-mall-mes`、`smart-layer-admin`、`smart-layer-app`、`zhdj-admin`、`zhdj-sms` |
| `custom` | 各自的写法 | `zhdj-app`（token 只在 `config.addTokenInHeader` 时才进 header，默认**根本不发 token 头**）、`zhdj-app-lay` / `zhdj-cms`（token 头 + 从 cookie 读语言，**并把 token 塞进 GET params**）、`build-version`（无） |

**`minimal` 那一组没有 `tenant-id`**——而 `tenant-id` 省略时后端会在部分路径静默选错租户（F26）。它们是靠 `token` 自己带租户信息，SDK 不能拿四头集合去凑。

另外两个只挂在个别实例上的头：

- `product.js:21` 的 `devicetype: 'PC'`（**只有它**；`product-no-token.js` 没有，尽管名字更像）
- `platform-mall-mes.js:16` 的 `Content-Type: application/json;charset=utf-8`；`zhdj-app-lay.js:19-21` / `zhdj-cms.js:15-17` 的 `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`

### 1c. 顺带查清的、不在上面四类里的差异

- **GET params 的序列化方式**：只有 `platform.js` 在拦截器里 `qs.parse(url 上的 query)` + `qs.stringify(params, { allowDots: true, skipNulls: true })` 再把结果拼进 url、并把 `params` 清空（`platform.js:53-84`）。其余实例把 `params` 交给 axios 的默认序列化器。两者对 `null`、数组、嵌套对象的输出**不一样**，不能混用。
- **响应成功判据**：`ret === 'SUCCESS'`（多数）/ `Number(code) === 0`（`mall-app.js:38`）/ `code === 200`（`smart-layer-admin.js:72`、`smart-layer-app.js:72`、`zhdj-sms.js:67`）/ `code === 200` 或 `ret === 'SUCCESS'` 二者取一（`zhdj-admin.js:56-59`）。还有 `smart-layer-*` 的 `code === undefined` 直接放行、`zhdj-admin` **返回整个包络**而不是 `data`。
- **退出登录的 code 集合**：`[401, 10001, 1002015001]`（platform / sale / mall-app）与 `[401, 10001]`（`platform-mall-mes`、`smart-layer-*`、`zhdj-sms`）、`[401, 6001]`（`zhdj-app`）三套。
- **`withCredentials`**：`platform` / `sale` / `platform-mall-admin` 是 `true`；`crm.js:11` 有一行被注释掉的 `// withCredentials: true`。**无头下 Node 没有 cookie jar，SDK 刻意不转发这个字段**（设了也是空转，转发反而假装实现了 cookie 语义）。
- **响应包装的开关名**：`platform` / `sale` / `product` / `crm` / `product-no-token` 用 `config.sourceResponse`；`platform-mall-admin` / `platform-mall-mes` 用的是 `config.sourceResult`。SDK 只认 `sourceResponse`。
- **参数名差异**：`smart-layer-admin.js:24-30` / `smart-layer-app.js` / `zhdj-sms.js` 在 GET 时把 `token` 也塞进 params；`zhdj-admin.js:26-32` 同样；`zhdj-app-lay.js:31-33` / `zhdj-cms.js:31-38` 默认也塞（`addTokenInParams !== false`）。

### 1d. 响应包络：当前实现与边界

`src/http/client.ts` 的 `applyEnvelope()` 已实现四档：标准 `ret === 'SUCCESS'`、`smart-layer` 的 code 判定与 `data/pages` 回退、`zhdj-sms` 的 ret/code 联合判定，以及 `mall-app` 的 `Number(code) === 0`。相关单元测试见 `test/http-envelope.test.ts`。

仍有两类源码差异没有独立画像：`zhdj-admin` 成功时返回整个包络，`build-version` 没有响应拦截器；SDK 目前均按 `portal-standard` 处理，不能据此宣称完整复刻。这些是静态核对发现的缺口，尚无本轮浏览器实测。

---

## §2 页面怎么声明自己用哪个实例

### 2a. 全局默认

`app/portal/main.js:42-48` 把 `platform.js` 的实例注入 `common/libs/renren`：

```js
setRenrenConfig({ http, cookie, storage, getToken,
  fieldNamePageNo: 'pageNo', fieldNamePageSize: 'pageSize', /* … */ })
```

**没有声明 = 没覆盖它 = 走 platform.js。** 这是推导，不是猜测。

### 2b. 六种声明形式（每一种都有页面在用）

| # | 形式 | 例子 | 易漏点 |
| --- | --- | --- | --- |
| 1 | 无声明 | — | 不是「漏了」，是**真的**走默认 |
| 2 | **简写属性** `{ http, … }` | `views/dashboard/sale/shop/rule/list.vue:41` | 第一版正则只认 `http:`，把 34 个页面全判成「走默认」 |
| 3 | 显式键 + `as` 别名 | `views/dashboard/sale/sys/dict/list.vue:104` 传 `httpCrm`，来源是 `import { http as httpCrm } from '…/http/crm.js'` | 名字不叫 `http` 时，只按名字找不到来源 |
| 4 | **import 路径没写 `.js`** | `views/dashboard/sale/trade/logistic-template/list.vue:53`：`from 'app/portal/utils/http/sale'` | 只匹配 `…/http/X.js` 会漏 |
| 5 | 局部别名转发 | `const saleHttp = …` 再传 `{ http: saleHttp }` | 只查 import 会漏 |
| 6 | **`useListPageModule` 本身从 preset import** | `views/dashboard/product/components/my-plan/index.vue:98` 从 `common/libs/renren/presets/product/list.js` 引入 | 调用点上**一个字都看不到**；实例写死在 preset 里（`presets/product/list.js:3` = `product.js`，`presets/platform/list.js:3` = `platform.js`） |

同族的还有 `useFormPageModule`（`common/libs/renren/presets/product/form.js:3` 也写死 `product.js`，6 个文件在用它）——**表单提交走哪个实例是同一个问题的另一半，今天没有推导**。

`useListPageView`（`common/libs/renren/list-ui.js`）只负责列表的吸顶/滚动/布局，**不决定请求的 http**，不参与推导。

### 2c. 推导结果

早期扫描的全部 `useListPageModule` 调用 **1096 处**（含组件），其中显式声明实例的 **73 处**（61 处 `http` + 12 处 preset）。按下表分流：

| 分类 | 条数 | 进表？ |
| --- | --- | --- |
| 页面路径成形、实例不是默认 | **37** | ✅ 进 `HTTP_INSTANCE_PAGE_RULES` |
| 显式传 `platform`（线上字节与不传一样） | 17 | ❌ 收进来只会制造「这条规则有意义」的错觉 |
| `views/dashboard/product/**`（iframe 子应用） | 10 | ❌ 见下 |
| 页面内的弹窗/子组件（`/components/`、`/actions/`） | 6 | ❌ 按 pagePath 寻址不到 |
| 带路由参数的子页（`[id]` / `[type]`） | 3 | ❌ 同上；其中 `sale/setting/dict/data/[type]/items.vue` 归一化后仍落到表里的 `…/dict/list`，结论一致 |
| 其余（无声明） | 1023 | 走全局默认，不需要条目 |

> **追不动的声明会进表成 `instance: null`，运行时拒绝发请求。** 这是**失败关闭**，
> 与 `module-type` 的「算不出就不发这个头」刻意相反（`docs/conventions.md` 第 26 条）：
> 少一个头是忠实的，走错实例是打到错的 URL。今天这条表里**没有**这样的条目，但机制是通的——
> 而且**测试是先证红再钉住的**：把推导器里 `null` 那条分支并回 `platform` 那条 `continue`，
> 固件用例立刻变红，合成仓库里那两个页面会整条从推导结果里消失。
> （这句「有测试钉住」在 2026-09-20 之前是**假的**——那时推导器根本产不出 `null` 条目。）

**iframe 子应用**：`app/portal/menus/product/breeders.js:9` 这类菜单项是
`iframeLinkGeneratorNormal(base_url + '/chicken-farm-saas/my-plan')`（`app/portal/utils/menu.js:24-26`），
permission 是 `/dashboard/frame/…`。被嵌进去的那套页面源码也在 `app/portal/views/dashboard/product/` 下，
**但它的文件路径不是 Portal 的页面路径**，Portal 侧能寻址的只有 `/dashboard/frame/…`。
两边的映射需要单独推导，今天没有——所以 **`/dashboard/frame/**` 页面上的请求会被判成走默认实例，而真相是 `product.js`**。这是当前最大的一个已知缺口，见 §3。

### 2d. 推导器

`test/http-instances.test.ts` 里的 `derivePageRulesFrom(files)`：零依赖、纯 Node、只做括号配对 + import 解析，不引 Vue parser。`PORTAL_REPO`（默认 `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`，固定分支 `test/portal/main`，见 `docs/conventions.md` 第 32 条）存在时，测试会**重新推导一遍并与表逐条比对**；不存在时跳过那一层，但同时用内联固件把同一套逻辑跑一遍（否则「跳过」就等于「没测」）。

表的键是**机械推导**出来的：`app/portal/views/<x>.vue` → `/<x>`。

---

## §3 已知未建模 / 近似的地方（诚实清单）

1. **`/dashboard/frame/**`（iframe 内嵌）页面**：被嵌的页面源码不在 Portal 视角下，实例推导不到。这些页面的能力必须**显式**指定实例（`config.httpInstance`），不要指望页面推导。
2. **同一次页面操作里可能有多个实例**。实测 262 个页面 import 了非默认实例，其中 21 个页面在 `useListPageModule`（走默认）之外还直接 `http.get(...)` 打另一个实例。所以实例是**逐请求**的输入——页面推导只给「这个页面的列表请求」的默认值，别的请求要自己声明。
3. **`zhdj-admin` 的 `.lay` 挂在请求级 `isLay` 上**；SDK 用 `config.httpFlags.isLay` 表达，没有这个 flag 就不加后缀。
4. **`zhdj-cms.js:22` 判的是 `url.includes('.lay')`，SDK 判的是 `endsWith('.lay')`**；`zhdj-admin.js:16` 是**无条件**追加（不判重）。SDK 统一用 `endsWith` 防重复追加——差异只在「url 中间恰好含 `.lay`」这种极端输入下出现。
5. **条件性请求头未建模**：`zhdj-app-lay.js:39` / `zhdj-cms.js:47` 会在某个条件下把 `Content-Type` 覆写成 JSON；SDK 的 `extraHeaders` 记的是无条件的那一份，条件开关只对 url 后缀开放。
6. **`config.sourceResult` 这个开关名没复刻**（`platform-mall-admin` / `platform-mall-mes` 用它）。SDK 只认 `sourceResponse`。
7. **`withCredentials` 不转发**（Node 没有 cookie jar）。
8. **`useFormPageModule` 的实例没推导**（见 §2b）。
9. `platform.js` 的 `generateHttpHeaders({ moduleType })` 覆盖分支**不做真值判断**（`system.js:826-827`：`!== undefined` 就写），默认分支才做（`:828-833` 的 `if (moduleType)`）。SDK 统一用 `!== undefined && !== null`——差异只在 `module-type` 解析结果为 `0` 时出现，而规则表里没有 0。

---

## §4 哪些是实测、哪些是推断

**已有浏览器基准**

- `sale.js` 不补 `/admin-api` + 分页名 `limit`：浏览器基准 `batch-report.json` 的 `/dashboard/sale/customer-service/after-sale/list` 一条，URL 为 `https://biz-api-test.wodecorp.cn/admin-shop-api/admin/aftersales/page?...&pageNo=1&limit=20`。
- `platform.js` 补 `/admin-api` 且透传 `/adminmanage-api`、`/mall-manage-api`：仓库既有基准 `baseline/meeting-room-page.browser.json` + `batch-report.json` 里 `/dashboard/platform/setting/category-dict/list` 的 `https://biz-api-test.wodecorp.cn/adminmanage-api/system/category-dict/tree?...`、`/dashboard/platform/activity/monitor/list` 的 `https://biz-api-test.wodecorp.cn/mall-manage-api/sys/coupon/page?...`。
- 逐页覆盖 `fieldNamePageSize`：`batch-report.json` 里 `/dashboard/flow/old/model/list` 的浏览器 URL 真的是 `limit=20`。

**本轮源码校对（未重新实测页面）**

- 全局默认实例是 `platform.js`：`app/portal/main.js:42-48` 源代码。
- 2026-09-22 对 `test/portal/main` 的 `82651c98c5` 静态复核：HTTP 目录 16 个文件、17 个实例；删除已零引用的 `hr.js` 画像（Portal 删除提交 `c0f1ba9283`）。37 条页面规则与源码重推导一致。源码比对测试覆盖实例文件集合、baseURL env、补前缀、分页改名与固定头，未覆盖所有拦截器行为。

**推断（未实测）**

- **页面规则的本轮复核**未新抓浏览器基准，是从源码静态推导的。`resolveHttpInstance` 的结论正确性依赖推导器，不依赖实测。
- **`platform-mall-mes` 的 `Content-Type`、`product` 的 `devicetype: PC`、`zhdj-*` 的 `.lay` 后缀**：只有源码依据，没有浏览器基准。
- **`/dashboard/frame/**` 与 `views/dashboard/product/**` 的对应关系**：只确认了菜单项是 iframe 生成器 + 文件路径不是 Portal 页面路径，**没有**确认某个 iframe 页面到底加载哪个 vue 文件。
- **响应包络**：四档已有单元测试；本轮未做线上实测，仍未独立建模的两类见 §1d。

---

## §5 「透传白名单漏了 `/admin-shop-api` 与 `/admin-crm-api`」这个说法不成立（2026-09-20 复核）

`docs/base-capabilities.md` 的 P0-0 写着：platform 实例的 passthrough 白名单**不含** `/admin-shop-api`
与 `/admin-crm-api`，而测试环境这 4 个网关同 host，所以「A 层 #3、#14~#17 这 5 条能力会被补成
`/admin-api/admin-shop-api/...`，静默打到错 URL」，产出是「把这两个前缀加进 passthrough」。

**复核结论：诊断与产出都不对。判据以前端为准（`app/portal/utils/http/platform.js:18-20`），
那张表不加项，通路是「换实例 + 配它自己的 baseURL」——这条已经实现。**

### 5a. 数出来的差集（自己数的，不是照抄调查）

| 项 | 数 | 依据 |
| --- | --- | --- |
| 与 platform 同 host、不同前缀的实例 | **4**（platform 自己是 host 根，共 5 个） | `build/env/.env.build.test:11-75`：`/admin-shop-api`(sale)、`/admin-crm-api`(crm)、`/mall-manage-api`(platform-mall-admin)、`/mall-api`(mall-app) |
| 前端 passthrough 的否定项 | **3** | `platform.js:18-20` 原文 |
| **不在**透传表里的同 host 前缀 | **3**，不是 2 —— 调查漏了 `/mall-api`（`mall-app.js`） | 同上 |
| 规则表里走 `sale` / `crm` 的页面 | **32 / 4**（另有 1 页走 `platform-mall-mes`，共 37 条） | `HTTP_INSTANCE_PAGE_RULES`（`test/http-instance-prefix.test.ts` 可复核） |
| 生成物里真正会发请求到 `sale` / `crm` 的**能力** | **0** | `batch-capabilities.ts`：4 条 sale 页契约是 `scope: "out-of-scope"`，`createBatchListCapability` 直接拒绝创建（决策 D3）；crm 页没进抽样 |

调查说的「5 条能力」（A 层 #3 的 `{CRM}/vue/getUserInfo` 与 #14~#17 的 4 条 `{SHOP}`）**今天都不存在**
——它们是 §7 P2 里的**建能力提案**，且按 D3 属范围外。所以「影响 5 条能力」是把提案当现状数了。

### 5b. 判据：透传表不是「同 host 白名单」，而是「页面真的会把它当路径写」

在 `app/portal/**` + `common/**`（6397 个文件）里数字符串字面量以该前缀开头的处数：

| 前缀 | 处数 | 怎么用的 |
| --- | --- | --- |
| `/admin-api` | 2779 | 页面大量写全前缀路径（所以表里有它，防重复补） |
| `/adminmanage-api` | 157 | `system.js:135` 的 `/adminmanage-api/adminmanage/platform-config/list` 这类 |
| `/mall-manage-api` | 153 | `getDataListURL: '/mall-manage-api/sys/...'`（seller/category 一片页面） |
| `/admin-shop-api` | **0** | 只作为 `VITE_SHOP_ADMIN_API` 出现在 `sale.js:9` 的 `baseURL`，以及完整 URL（`window.location` / `newPage`） |
| `/admin-crm-api` | **0** | 只作为 `VITE_CRM_API` 出现在 `crm.js:9` 的 `baseURL` |
| `/mall-api` | **0** | 只作为 `VITE_MALL_APP_API` 出现在 `mall-app.js:9` 的 `baseURL` |

也就是说：**进了透传表的三段前缀 ⇔ 前端真的把它们当路径写过**，一一对应。后三个是**另外三个 axios
实例各自的 baseURL**，路径里不带前缀（`httpSale.get('/admin/shop/getInfo')`、`httpCrm('/vue/getUserInfo')`）。
「platform 客户端收到 `/admin-shop-api/...` 这种路径」这个输入在前端**不存在**——不存在就没有浏览器行为可复刻。
往表里加它们 = 发明，且会让 `test/http-instances.test.ts:554`（按源码重推导）与本文件新增的用例一起变红。

### 5c. 真实环境实测（只读，2026-09-20，测试环境）

```bash
./smoke/with-portal-token.sh node smoke/read-http-instance-prefix.mjs
```

| URL | HTTP | 包络 |
| --- | --- | --- |
| `{base}/admin-api/admin-shop-api/admin/shop/getInfo`（怕的那条） | **200** | `{"code":404,"ret":"FAIL","msg":"请求资源不存在:No static resource admin-api/admin-shop-api/admin/shop/getInfo."}` |
| `{base}/admin-api/admin-crm-api/vue/getUserInfo`（怕的那条） | **200** | `{"code":404,"ret":"FAIL",...}` |
| `{base}/admin-shop-api/admin/shop/getInfo`（实际通路） | 200 | `{"ret":"SUCCESS","data":{"shopId":2,"shopName":"峪口禽业旗舰店",...}}` |
| `{base}/admin-crm-api/vue/getUserInfo`（实际通路） | 200 | `{"ret":"SUCCESS","data":{"id":"f90dc0e7...",...}}` |

两点值得记下来：

1. **失败形态是「HTTP 200 + `ret:FAIL`」**，不是 404 状态码 —— 只看状态码的监控发现不了。
   （`src/http/client.ts` 的响应拦截器会把它变成带 `code=404` 的 `PortalApiError`。）
2. 同一批请求**走 SDK** 也是上面的结果（`test/http-instance-prefix.test.ts` 的 LIVE 组，命令：
   `./smoke/with-portal-token.sh pnpm exec vitest run test/http-instance-prefix.test.ts`）：
   sale 实例实际发出 `https://biz-api-test.wodecorp.cn/admin-shop-api/admin/shop/getInfo` 并拿到
   `shopName`；crm 实例实际发出 `https://biz-api-test.wodecorp.cn/admin-crm-api/vue/getUserInfo` 并拿到 `id`。

### 5d. 所以「跨网关前缀」这条路今天长什么样

- **正路**：能力/请求显式声明实例（`config.httpInstance = 'sale' | 'crm' | …`，或由页面规则命中），
  并在 `httpBaseUrls` 里配上该实例的 baseURL（`src/config.ts:39`）。没配 → `createPageCall` 抛
  `HttpInstanceResolutionError('missing-base-url')`，**一个请求都不发**（`src/call.ts:110-123`）。
- **不是正路**：把 `/admin-shop-api/...` 当路径塞给默认实例。SDK 会照 `platform.js` 补成
  `/admin-api/admin-shop-api/...`——这是**复刻**（前端对任何未列入的前缀都这么干），
  不是 SDK 的 bug；所以护栏放在「不许产生这种输入」：`test/http-instance-prefix.test.ts` 的两条
  全仓守卫（生成物契约 + 手写能力/基础数据的 url 字面量）。
- **完全接不到**的仍是那些**页面规则命中 `sale`/`crm` 但调用方不配 baseURL** 的情形 —— 那会抛，不会打错。
  另外 `/dashboard/frame/**` 的推导缺口见 §3。

### 5e. 这一轮加的反证（改坏了什么 → 红了几条）

| 改坏 | 红 |
| --- | --- |
| 往 platform 的 passthrough 塞 `/admin-shop-api` + `/admin-crm-api`（调查提的改法） | 3（本文件 2 + `test/http-instances.test.ts` 的源码比对 1） |
| 去掉「必须以前导 `/` 开头」这个守卫 | 1 |
| 把 `sale` 的 `urlRewrite` 从 `none` 改成 `prepend-absolute` | 3 |
| 把 `crm` 的 `baseUrl.env` 改成 platform 的 | 1 |
| 把 shop 的 `pathInFrontend` 谎报成 `true`（假装前端真把它当路径写过） | 3 |

另外三条判据自带合成输入的反证（守卫的违规清单、url 字面量抽取器、路径计数器），每次跑都在证。
