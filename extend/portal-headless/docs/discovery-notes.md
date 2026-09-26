# Portal 无头化可行性 —— 发现记录

记录时间：2026-09-20
分析对象：`/Users/liyang/Documents/code/wdbc/Projects_Js` （分支 HEAD，最近提交 `f096a38fb4`）

> **来源已切换（2026-09-22）**：本文仍是那次扫描的**原始观测**，上面的分析对象是它的历史基线，保留不动。
> 当前的参考来源是 `/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js`（固定分支 `test/portal/main`），
> 口径见 `docs/conventions.md` 第 32 条。**换来源不等于本文的观测已在新检出上复核。**
分析范围：`app/portal`（主）、`common`（共享层）

## 本文的校对状态（最后对齐 2026-09-20）

本文是 `docs/design.md` 的**前身**：它只记录"当时观测到了什么"，不含方案与建议。设计文档里凡引用"发现记录 §X"的地方，正文已经并进来了，这里保留的是原始观测。

**校对到什么程度**：

- 每条结论自带来源标注（`[实测]` / `[静态分析]` / `[代码引用]`），**以标注为准**——`[实测]` 的最可信，`[静态分析]` 的随扫描口径变化。
- 行号与计数**对到分析基线 `f096a38fb4`**（见本文末尾 §13 第 6 条）。代码已经往前走了，行号可能漂移。
- **只做了局部校正**：后续实测推翻了的条目，在它旁边加了 `⚠️ 实测校正（2026-09-20）` 标注；其余条目**未逐条复核**，按"当时的观测"读，不要当现状。
- 本文**不是事实来源**。与 `docs/design.md`、`docs/conventions.md`、`src/context/README.md`、`generated/**` 冲突时，一律以后者为准。

---

## 0. 阅读说明

本文只记录观测结果，不含任何方案或建议。

每条发现标注来源：

- **[实测]** —— 在分析过程中实际执行命令/代码得到的结果，附命令
- **[静态分析]** —— 通过 grep/AST 类静态扫描得到，附方法
- **[代码引用]** —— 直接读取源码得到的结论，附 `文件:行号`

---

## 1. 代码规模

### 1.1 文件与行数 **[实测]**

命令：`find app/portal -name "*.vue" | wc -l`、`find ... | xargs cat | wc -l`

| 项 | 数值 |
| --- | --- |
| `.vue` 文件 | 5,352 |
| `.js` 文件 | 687 |
| `.vue` 总行数 | 702,309 |
| `.js` 总行数 | 61,681 |

按块拆分（脚本解析 `<template>` / `<script>` / `<style>` 标签内容）：

| 块 | 行数 |
| --- | --- |
| `<template>` | 185,720 |
| `<script>` | 433,826 |
| `<style>` | 11,898 |

> 说明：三者相加（631,444）小于总行数（702,309），差值来自无标签的顶层内容与标签间空行。

### 1.2 组件写法 **[静态分析]**

命令：`grep -rl "script setup" --include="*.vue" app/portal | wc -l`

| 写法 | 文件数 |
| --- | --- |
| `<script setup>` | 4,520 / 5,352 |
| `<route lang="yaml">` 内联路由元信息 | 1,680 |

### 1.3 script 行数分布 **[静态分析 ¹]**

| 区间 | 文件数 | 占比 |
| --- | --- | --- |
| ≤ 50 行 | 2,007 | 44.3% |
| 51–100 行 | 1,096 | 24.2% |
| 101–200 行 | 855 | 18.9% |
| 201–300 行 | 343 | 7.6% |
| 301–500 行 | 168 | 3.7% |
| 501–1000 行 | 55 | 1.2% |
| > 1000 行 | 6 | 0.13% |
| 合计 | 4,530 | |

- 脚本中位数区间为 ≤ 50 行；均值约 95 行
- `> 300 行` 的文件合计 **229 个（5.1%）**

¹ 该分布由子代理静态扫描得出，本次分析未独立复算。

### 1.4 其他分布 **[静态分析]**

| 项 | 数值 |
| --- | --- |
| 不含 `http` / `message` / `Modal` / `ref` / `reactive` 的 `.vue` | 2,159 / 4,530（48%） |
| 总行数 < 20 行的 `.vue`（路由壳） | 1,449（27%） |
| 引用 `vue-router` 的文件 | 992 |
| `.vue` 中的模板内联箭头 handler | 6,761 |
| `:disabled="..."` 业务表达式 | 3,883 |
| 含 `watch` 调用 | 722 处 |
| `watchEffect` | 44 处 |
| 出现 `.value` 的 script 行 | 约 27,945（占 script 6.5%） |

---

## 2. 网络请求层

### 2.1 请求规模 **[静态分析]**

命令：`grep -rhoE "http[A-Za-z]*\.(get|post|put|delete|patch)\(" --include="*.vue" --include="*.js" --include="*.jsx" app/portal common | wc -l`

| 项 | 数值 |
| --- | --- |
| `http.*` 调用点（portal + common） | 4,121 |
| 去重后唯一接口路径 | 2,736 |
| 含 http 调用的 `.vue` | 1,867（34.9%） |
| 这些文件内的 http 调用点 | 3,727 |

> 方法限制：路径提取用正则匹配 `.get('...')` 字面量，`${}` 模板串做了归一化。运行时拼接的 URL 会漏计。

### 2.2 接口路径的存放位置 **[静态分析]**

命令：`grep -rhoE "['\`\"]/(admin-api|...)/..." --include="*.vue" app/portal | wc -l`（对 `.js` 同法）

| 位置 | 路径字面量数 |
| --- | --- |
| `.vue` 文件内 | **2,862** |
| `.js` 文件内 | 211 |

页面级 service 文件（`service.js` / `api.js` / `*-api.js`）：**39 个**
其中不含 `vue` / `vue-router` / `ant-design-vue` import 的：35 个

### 2.3 axios 实例 **[静态分析]**

`app/portal/utils/http/` 下共 **17 个 `axios.create` 实例**：

`platform.js`、`product.js`、`product-no-token.js`、`sale.js`、`hr.js`、`crm.js`、`mall-app.js`、`platform-mall-admin.js`、`platform-mall-mes.js`、`smart-layer-admin.js`、`smart-layer-app.js`、`zhdj-admin.js`、`zhdj-app.js`、`zhdj-app-lay.js`、`zhdj-cms.js`、`zhdj-sms.js`、`build-version.js`

> ⚠️ 实测校正（2026-09-20）：**"17 个"是文件数，不是实例数。** 真实是 **17 个文件 / 18 个实例**——`zhdj-cms.js:106-107` 一个文件里 `createHttp` 被调两次，导出 `httpLay` 与 `http` 两个绑定。**"一个实例"的单位是导出的绑定，不是文件**；按文件建表会把这两个混成一个。
> 另外 `app/portal/utils/sale/code-serive.js:3` 还有一个 `axios.create()`（验证券码图片，`responseType: 'blob'`），但它在 `app/portal` 下**一个 import 都没有**，是死代码，不进表。
> 另外，这些实例**不全是"不同域名"**——其中 **4 个与主后端同 host、不同前缀**（`sale` → `/admin-shop-api`、`platform-mall-admin` → `/mall-manage-api`、`mall-app` → `/mall-api`、`crm` → `/admin-crm-api`），其余才是不同 host。本文当时没区分这两类。
> 逐实例的完整画像（baseURL / 补不补前缀 / 分页参数名 / 请求头形态 / 序列化 / 响应包络）见 `src/context/README.md` §1a，出处逐条带 `文件:行号`。

拦截器通用行为（以 `app/portal/utils/http/platform.js` 为例）：

- 请求拦截：`addStartTime` → 补 `/admin-api` 前缀（`platform.js:18-20`）→ 塞 `generateHttpHeaders()` → GET 追加 `_t` 时间戳（`platform.js:31-36`）→ `qs.stringify`
- 响应拦截：`ret !== 'SUCCESS'` 时，若 `code ∈ [401, 10001, 1002015001]` 调 `logout()`（`platform.js:117`），否则 `message.error(msg)`（`platform.js:127`）；成功时 `message.success(msg)`（`platform.js:139`）
- `responseType === 'blob'` 或 `sourceResponse` 时直接返回原始 response（`platform.js:98`）

各实例错误码数组不一致，硬编码为字面量：`[401, 10001, 1002015001]`、`[401, 6001]`、`[401]`。

`app/portal/utils/http/response-code.js` 定义了 `RESPONSE_CODE` 常量表（7 行），但不含 `1002015001`；实际消费者只有 `zhdj-admin.js` 与 6 个视图文件。

### 2.4 鉴权信息 **[代码引用]**

`app/portal/utils/system.js:813-836` `generateHttpHeaders()`：

```js
header['tenant-id'] = tenantId          // cookie
header['token']     = token             // cookie
header['module-type'] = moduleType      // 由菜单路径推导
header['Accept-Language'] = language    // cookie
```

- `getToken()` = `cookie.get('token')`（`system.js:29-31`）
- cookie 实际键名带前缀：`projectSign(name, project, version)` → `${project}-${version}-${name}`（`common/utils/string.js:96-98`），portal 侧 `project='hr'`、`version='0.0.0'`（`app/portal/utils/storage.js:9`、`app/portal/define.js`）
  - 即 `hr-0.0.0-token`、`hr-0.0.0-tenant`、`hr-0.0.0-menuPath`
- 请求层**无** token 刷新流程；401 直接 `logout()`
- `moduleType` 由 `getCurrentModuleType()`（`app/portal/menus/index.js:533-545`）计算，内部读 `window.location.href`（`menus/index.js:536`）

### 2.5 签名 **[实测]**

`app/portal/utils/http/sign.js`（全文 10 行）：key 字典序排序 → 拼 `key+value` → `md5` → 大写 → 拼接硬编码 64 位盐 → 再 `md5` → 大写。

- 无时间戳、无 nonce、无可变输入
- 同一份盐同样存在于 `app/zhdj-mobile/views/login/utils/sign.js:8`

实测在 Node 直接调用：

```
addSign({b:2,a:1}) → {"b":2,"a":1,"sign":"2D99F0585B4FFE3EAB579142C56936D9"}
```

### 2.6 后端地址 **[实测]**

`build/env/.env.build.prod` 等文件定义后端为**绝对域名**（无 dev proxy）：

| 变量 | 生产值 |
| --- | --- |
| `VITE_ZHDJ_PLATFORM_API` | `https://biz-api.wodecorp.cn` |
| `VITE_MALL_ADMIN_API` | `https://biz-api.wodecorp.cn/mall-manage-api` |
| `VITE_SHOP_ADMIN_API` | `https://biz-api.wodecorp.cn/admin-shop-api` |
| `VITE_CRM_API` | `https://biz-api.wodecorp.cn/admin-crm-api` |
| `VITE_MALL_APP_API` | `https://biz-api.wodecorp.cn/mall-api` |
| `VITE_EDUCATION_ADMIN_API` | `https://dhrapi.wodecorp.cn` |
| `VITE_SMART_LAYER_ADMIN_API` | `https://smart.wodecorp.cn/admin` |
| `VITE_SMART_LAYER_APP_API` | `https://smartapi.wodecorp.cn` |
| `VITE_MES_API` | `https://ptm.wodecorp.cn/PoultryMes` |
| `VITE_FM_API` | `https://fmu.wodecorp.cn/flockSimu` |
| `VITE_MARKET_API` | `https://store.wodecorp.cn/api/market` |
| `VITE_ZHDJ_CMS_API` | `https://smart.wodecorp.cn/admin` |

共 17 个 host 变量。`platform.js` 使用 `withCredentials: true`。

`import.meta.env` 在 `app/portal` + `common` 的 `.js`/`.jsx` 中共 **53 个文件**使用，涉及约 25 个 `VITE_*` 变量。

---

## 3. 模块依赖结构

### 3.1 `utils/system.js` **[实测]**

| 项 | 数值 |
| --- | --- |
| 行数 | 1,374 |
| 导出（`export function` / `export const`） | 74 |
| 引用它的文件数 | **1,176** |

顶部 import（`system.js:1-25`）包含：

```
vue, vue-router, lodash-es
common/utils/message.js          → ant-design-vue
common/libs/modal/index.jsx      → ant-design-vue + Vue
common/components/common/button/index.jsx
common/components/common/layout/dashboard/sidebar/define.js
app/portal/utils/router/index.js              （路由单例）
app/portal/menus/index.js                     （菜单树）
app/portal/utils/http/platform.js             （http 实例）
app/portal/utils/http/platform-mall-admin.js
app/portal/utils/http/crm.js / sale.js / product.js
```

### 3.2 循环依赖 **[实测]**

```
app/portal/utils/http/platform.js:5   → import { logout, generateHttpHeaders } from 'app/portal/utils/system.js'
app/portal/utils/system.js:16         → import { http } from 'app/portal/utils/http/platform.js'
```

### 3.3 顶层浏览器 API 依赖 **[静态分析]**

对 `common/utils` + `app/portal/utils` 下所有非测试 `.js` 扫描「模块顶层即访问 `window`/`document`/`navigator`/`localStorage`」：

命中 5 个文件：

- `common/utils/browser.js` —— `export const userAgent = navigator.userAgent`（第 8 行），第 23 行 `new UAParser(userAgent)`
- `common/utils/logger.js` —— 经 `browser.js`
- `common/utils/wx.js`
- `app/portal/utils/common.js`
- `app/portal/utils/common/login-device/main.js`

`common/utils/browser.js` 被 170 个文件引用。

### 3.4 路径别名 **[实测]**

`vite.config.js:213-218`：

```js
alias: { 'common': res('common'), 'app': res('app'), 'playground': ..., 'page': ... }
```

非 Node 可解析的包名。在 Node 中 import 任意 `app/portal` 模块会得到
`Cannot find package 'common'`。

### 3.5 `common/libs` 反向依赖 `app/*` **[静态分析]**

`common/libs/flow-form/index.js:9-10`：

```js
import { setModuleTypeInCookie } from 'app/portal/menus/index.js'
import { PATH_TASK_MY } from 'app/portal/menus/hr.js'
```

全仓同类反向依赖约 6 处。

---

## 4. renren 框架（列表页/表单页引擎）

### 4.1 使用面 **[静态分析]**

| 项 | 数值 |
| --- | --- |
| 引用 `common/libs/renren/*` 的文件 | 2,460 |
| 使用 `useListPageModule` 的 `.vue` | 1,092 |
| 使用 `useListPageView` 的 `.vue` | 1,009 |
| 两者都用（标准列表页） | 998 |
| 使用 `useFormPageModule` 的 `.vue` | 369 |
| 去重合计 | **1,460**（占全部 `.vue` 的 27%） |

### 4.2 文件构成 **[实测]**

| 文件 | 行数 |
| --- | --- |
| `common/libs/renren/list.js` | 758 |
| `common/libs/renren/form.js` | 248 |
| `common/libs/renren/list-state.js` | 135 |
| `common/libs/renren/list-ui.js` | 121 |
| `common/libs/renren/config.js` | 41 |
| `common/libs/renren/bridge.js` | 35 |

### 4.3 依赖注入 **[代码引用]**

`common/libs/renren/config.js` 定义 `setRenrenConfig({ http, cookie, storage, getToken, fieldNamePageNo, fieldNamePageSize, listPageStateCache })`，在 `app/portal/main.js:31-41` 注入浏览器实现。

`config.js` 默认值中 `http/cookie/storage/getToken` 均为 `null`。

### 4.4 `list.js` 的 Vue 依赖 **[代码引用]**

`common/libs/renren/list.js:6-23`：

```js
import { computed, ref, unref, isRef, reactive, watch, inject, getCurrentInstance, onActivated, onBeforeUnmount } from 'vue'
import { matchedRouteKey, onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { message } from 'common/utils/message'
```

`list.js:579-613` 返回 `propsForTable` / `propsForPagination` 等 antd 组件的 props 对象。

### 4.5 声明式 vs 逃生口 **[静态分析]**

| 页面类型 | 声明式参数 | 数量 | 逃生口参数 | 数量 |
| --- | --- | --- | --- | --- |
| 列表加载（1,092） | `getDataListURL` | **407** | `customLoad` | **923** |
| 表单提交（369） | `objectURL` | **23** | `customSubmit` | **321** |
| 删除 | `deleteURL` | 124 | `customDelete` | 99 |
| 导出 | `exportURL` | **15** | — | — |

`customLoad` 的结构（`app/portal/views/dashboard/finance/investment/budget-summary/list.vue:102` 等）：一个函数，形如「组件 props + form → 参数变换 → http 调用 → 响应后处理」。

示例（`app/portal/components/portal/finance/business-bill-select/components/purchase.vue:131-143`）：

```js
async function actionGetPageCountAndList (form) {
  const params = {
    ...form,
    startDate: form.dateRange?.[0],
    endDate: form.dateRange?.[1],
    categoryId: props.categoryId,
    materialCategoryIds: form.materielCategoryIds?.join(',') || undefined,
  }
  delete params.dateRange
  delete params.materielCategoryIds
  const result = await http.get('/admin-api/finance/bpm-budget-request-form/getPurchasePage', { params })
  return result
}
```

对 923 个含 `customLoad` 的文件的函数体扫描：

| 项 | 数值 |
| --- | --- |
| 在本文件内定义命名加载函数（`actionGetPageCountAndList` 等） | 188 |
| 内联函数体总行数 | 3,068（均值 16 行） |
| 函数体内直接含 `http.*` 调用 | 169 |
| 函数体依赖 `props.` | 12 |

### 4.6 跨页传参 `bridge` **[代码引用]**

`common/libs/renren/bridge.js`：

```js
export function bridgeSet (data) {
  const id = id8()
  config.storage.set(`bridge-${id}`, JSON.stringify(data))   // → localStorage
  return id
}
export function useBridge () {
  return bridgeGet(useRoute().query.bridge)
}
```

数据存于**发起方浏览器的 localStorage**，URL 中只有 `?bridge=<id>`。实际键名：`hr-0.0.0-bridge-<id>`。

---

## 5. 路由、菜单与权限

### 5.1 路由生成方式 **[代码引用]**

- `vite.config.js:140-152`：`vite-plugin-pages` 的 `Pages()`，`pagesDir` 为各 app 的 `views` 目录，`onRoutesGenerated: projectRoutes`
- `app/portal/utils/router/index.js:2`：`import routes from 'virtual:generated-pages'` —— Vite 虚拟模块
- `app/portal/utils/router/index.js:8-11`：`createRouter({ history: createWebHashHistory(), routes: normalizePortalRoutes(routes['portal']) })`

全仓在 `app/` + `common/` 下无业务代码调用 `router.addRoute` / `removeRoute`。

路径映射为文件系统约定式，并有修正规则（`app/portal/utils/router/routes.js:6-17`），包括：

- `views/dashboard/hr/**` → `/dashboard/**`（`hr` 一层被去掉）
- `views/dashboard/education/**` → 同上去掉 `education`
- `views/dashboard/common/**` → 同上去掉 `common`
- `/simple/common/` → `/`

`app/portal/views/index.vue:5-9` 调用 `redirectFirstView()`（`system.js:757-762`），落点由权限过滤后的第一个菜单决定。

### 5.2 路由守卫 **[代码引用]**

`app/portal/utils/router/index.js:14-21`：

```js
router.beforeEach(async (to, from, next) => {
  syncMenuContext(to.path)
  prepareRouteEntry(to)
  if (handleSpecialEntryRoute({ to, next })) return
  await handleAuthRoute({ to, next })
})
```

初始化连链（`app/portal/utils/router/session.js:35-59`）串行 + 并行调用：

```
fetchUserInfo()           → /sys/user/info
getSalesUserInfo()        → /vue/getUserInfo
fetchTenantList()
fetchTenantSystem()       → /admin-api/system/tenant/get
Promise.all([
  fetchPermissions()      → /admin-api/sys/menu/permissionsNotBySystem
  fetchSensitive(), fetchAllDicts(), fetchAllPlatformDicts(),
  fetchSecurityConfigs(), fetchOrganization(), fetchSaleAllState(),
  fetchMallAdminAllDicts(), fetchMallAdminSaleDicts(), fetchMallAdminAreaInfo()
])
```

`app/portal/utils/router/init-profile.js` 提供声明式 profile（`simple-lite`），仅对 `/simple/*/form/*` 生效，从 `to.matched` 取 `meta.initProfile`，能力失败时回退 `full-init`。能力注册表在 `app/portal/utils/router/base-data.js:57-104`。

### 5.3 菜单 **[代码引用]**

- 菜单树为**前端静态常量**：`app/portal/menus/{hr,finance,sale,mall.v2,product,material,supply,technology,common}.js`，在 `app/portal/menus/index.js:101` 聚合为 `all_menus`
- 节点形态：`{ title, path, permission, icon, children }`
- 菜单节点 `path` 与路由 URL 靠约定对齐，二者不是同一份数据源
- 后端**不下发菜单树**，只提供权限码
  > ⚠️ 实测校正（2026-09-20）：**这句话是错的——但不是本文自己查出来的，是后来打开后端仓库才查到的（`docs/design.md` F18）。** 后端**有**一个按当前用户过滤的菜单树接口：`GET /admin-api/sys/menu/nav?project=`（`HrSysMenuController.java:46-54`，返回 `SysMenuDTO`，含 `children[] / permissions / useSystem / project / menuType`）。**Portal 前端不用它，是因为菜单是前端静态常量**——这是"前端没用"，不是"后端没有"。
  > 另有两处当时的写法与实际不符（同批查证）：① 菜单节点的 `url` **恒为 null**，页面路径实际在 `permissions` 字段里，且**从不是逗号分隔**（2,848 个节点里逗号 0 次）；② **菜单树不是权限裁决**——某账号的 `/dashboard/meeting-room/list` 不在它的 `nav?project=2` 里，而该能力是可调的。
  > 出处：`docs/design.md` F18 与 D8 的实测校正、`docs/conventions.md` 第 15、16 条、基线 `baseline/menu-nav.sample.json`。
- `app/portal/menus/index.js:176-508` 为 `all_menus_type_match`，约 330 行路径前缀匹配规则，用于推导 `moduleType`（进入请求头）

### 5.4 权限 **[代码引用]**

- 唯一权限来源：`GET /admin-api/sys/menu/permissionsNotBySystem`，返回一维字符串数组（`system.js:689-698`）
- 无自定义指令（全仓无 `app.directive` / `.directive(`）
- 判定函数：`permissionCheck()`（`system.js:710-726`）、`permissionFilter()`（`system.js:728-736`）、`buttonPermissionFlag()`（`system.js:1008-1011`）
- 菜单过滤落点：`app/portal/components/portal/layout/index.vue:212`
- 路由级鉴权：`meta.permission` + `app/portal/utils/router/sale.js:101-127`

### 5.5 查询参数 **[代码引用]**

`app/portal/utils/router/entry.js:5-49` 及各调用点涉及：

`token`、`tenant`、`fromMarket`、`isMobileForce`、`platform`、`bpmMode`、`bpmBusinessKey`、`bpmBusinessKeyLast`、`instanceId`、`bpmProcessStatus`、`mode`、`print`、`processDefinitionKey`、`formCustomCreatePath`、`bridge`、`flow`、`url`

其中 `isMobileForce`、`bpmMode` 参与决定渲染 PC 还是 Mobile 视图（`common/libs/flow-form/index.js:99-102, 159-183`），默认分支由 `navigator.userAgent` 决定（`common/utils/browser.js:30`）。

---

## 6. 声明式表单（`views/simple`）

**[静态分析]**

| 项 | 数值 |
| --- | --- |
| `views/simple` 下 `.vue` 数 | 659 |
| `page/pc/edit` 目录数 | 95 |
| `page/pc/detail` | 95 |
| `page/mobile/edit` | 95 |
| `page/mobile/detail` | 96 |
| `page/print` | 49 |
| `original-fields.js` | 1 |

单个表单结构示例（`views/simple/sales/form/012/`）：

```
original-fields.js
index.vue
第三方支付申请.md
page/print/index.vue
page/pc/edit/index.vue
page/pc/detail/index.vue
page/mobile/edit/index.vue
page/mobile/detail/index.vue
```

`original-fields.js` 导出 `getOriginalFields(source)`，返回 `[{ key, label, display }]` 形式的数据；其内部依赖 `getPlatformDictLabelByValue`、`getTenantShopList`（来自 `app/portal/utils/system.js`）。

`views/simple/*/form/*/index.vue` 为路由壳，通过 `useFlowForm` 按 pc/mobile × edit/detail 分发。

---

## 7. UI 组件承担的流程控制

**[静态分析]**

| 项 | 数值 |
| --- | --- |
| 使用 `useModal` / `createModal` / `FunctionalModal` 的 `.vue` | 1,158 |
| `Modal.confirm` 调用点 | 153 处 / 121 文件 |
| 使用 `formRef.validate()` 做校验的文件 | 381 |
| `message.*` 调用行 | 4,629 |
| 使用 `message.success` / `message.error` 的 `.vue` | 1,261 |
| 使用 `loopFetch` 的 `.vue` | 63 |
| 涉及审批流（`bpm` / `flow-form` / `approve` / 审批）的视图 | 620 |

典型结构（`app/portal/views/dashboard/hr/flow/form/detail/index.vue:499-539`）：

```
a-button @click
 └─ handleAudit(task, true)
    ├─ auditForms[index] 取值
    ├─ if (!pass && !data.reason) message.error('...建议不能为空')
    └─ Modal.confirm({ onOk })
       └─ http.put('/bpm/task/approve', data)    ← 唯一 IO，位于 onOk 回调内
          ├─ message.success(...)
          └─ router.back()
```

同类结构（`.../detail/index.vue:589-618`）：`handleBack()` 先 `http.get('/bpm/task/list-by-return')`，再按返回条数决定弹确认框、选择框或 `message.warning`。

---

## 8. 硬编码业务规则

**[静态分析]**

| 位置 | 数量 |
| --- | --- |
| 模板 `v-if` 中的数字比较 | 993 处 / 453 文件 |
| script 中 `status/type/result === 数字` | 1,100 处 |
| `.vue` 内声明的 UPPER_CASE 枚举常量 | 265 处 |
| 组件内 options/dict 常量 | 101 处 |

示例（`app/portal/views/simple/supply/form/006/page/pc/edit/index.vue:1466-1472`）：

```js
function getSubmitStatus () {
  // 内采订单 常规类 传2
  if (totalState.value.purchaseType === '2' && totalState.value.internalPurchaseType === '1') {
    return 2
  }
  return totalState.value.purchaseMethod === '4' ? 2 : 8
}
```

示例（`app/portal/views/dashboard/hr/flow/form/detail/index.vue:409/432/445`）：

```js
if (processDefinition.formType !== 20) ...
if (task.status !== 4) ...
if (task.status !== 1 && task.status !== 6) ...
```

反面数据点：仓内已有 **133 个 `define.js`**，被 364 处 `.vue` 引用。

---

## 9. 浏览器专有能力

**[静态分析 + 代码引用]**

### 9.1 不存在的能力

| 能力 | 全仓命中 |
| --- | --- |
| `WebSocket` | 0 |
| `EventSource` | 0 |
| `BroadcastChannel` | 0 |
| `Web Worker` | 0 |
| `getUserMedia` / `MediaRecorder` / `RTCPeerConnection` / `getDisplayMedia` | 0 |
| `import ... from 'xlsx'` | 0（300 处 xlsx 命中均为 MIME 字符串） |

唯一流式长连接：`app/portal/views/dashboard/common/chat/components/ChatConversation.vue:654-664`，`fetch` + `response.body.getReader()`（POST + FormData）。

### 9.2 上传

- 唯一出口 `common/utils/oss.js`：`ossPut`（第 149 行）、`ossMultipartUpload`（第 207 行）、`ossDeleteMulti`（第 245 行）
- 使用 `ali-oss` SDK，AK/SK 来自 `import.meta.env.VITE_OSS_V2_ACCESS_KEY_ID/SECRET`（`oss.js:18-49`）
- 上层封装 `common-upload-*` 组件出现于 171 个文件；原生 `a-upload` / `a-upload-dragger` 另 44 个文件
- APP 内文件选择桥：`common/hooks/app-upload.js:20-30` 通过 `window.flutterUpload.postMessage(...)`
- `document.createElement('input')` 出现 28 处

### 9.3 下载

`common/utils/file.js` 实现：`fileDownload`（:92）、`fileDownloadByStream`（:99）、`fileDownloadByStreamV2`（:112）、`downloadFileFromUrl`（:127）、`generateKKFileUrl`（:38）。

依赖 `Blob` + `document.createElement('a')` + `URL.revokeObjectURL`。

两种后端交互模式：

- 模式 A：`responseType: 'blob'`（25+ 处），后端返回字节流
- 模式 B：后端返回文件名，前端拼 `?token=` URL 交给浏览器下载（`app/portal/hooks/product/use-report-export.js:98-107`）

### 9.4 前端生成的导出物

| 产物 | 位置 |
| --- | --- |
| docx | `common/utils/docxtemplater.js:44,113`（PizZip + Docxtemplater + `file-saver`） |
| PDF | `views/dashboard/hr/year-agreement/common/export.vue:36,68`、`views/dashboard/hr/month-agreement/common/export.vue:43,95`、`views/dashboard/hr/staff/personal-info/list.vue:300,400`（`html2pdf()`） |
| CSV | `views/dashboard/platform/operations/message/components/send-object.vue:33` |
| XML | `views/dashboard/hr/org/org-setting/utils/draw.js:528` |
| TXT | `views/dashboard/hr/org/org-setting/utils/text.js:146` |

### 9.5 打印

`app/portal/utils/print/index.js`（172 行）：

- `usePrintStyle()`（:67）注入 `<style media="print">`，含 `@page { size: A4 portrait; margin: 0 }` 与 `print-color-adjust: exact`
- `printCurrentPage()`（:96）调用 `window.print()`（:101）
- `usePrintPage()`（:105）组合 `useTitle` + `usePrintStyle` + `print()`

裸 `window.print()` 调用 19 处，集中在 `app/portal/components/portal/finance/document-*` 下的财务凭证/单据组件。

`print-js`、`pdfjs-dist` 在 `package.json` 中但无引用。

### 9.6 表/图表/地图/编辑器

| 能力 | 位置 | 规模 |
| --- | --- | --- |
| ECharts | `views/dashboard/common/home/utils/echarts/index.js`、`components/portal/product/record-chart/index.vue` | 63 文件 / 140 处 |
| echarts-wordcloud | `views/dashboard/platform/intelligence/interaction/dataAnalysis/components/word-cloud.vue:12` | — |
| @antv/g6 | `views/dashboard/hr/org/org-setting/components/chart-tree-ant.vue:9,25`；`.../tree.js`（1504 行，G6 v3） | — |
| jsmind | `views/dashboard/hr/org/org-setting/components/chart-tree-mind/index.vue:7` | — |
| 高德地图 | `views/dashboard/product/transport/map/list.vue:6,12-21`（`AMapLoader.load`，硬编码 key） | — |
| canvas 二维码 | `views/dashboard/sale/marketing/coupon/components/view-coupon-qr.vue:39-46` 等 4 处 | — |
| canvas 视频截帧 | `components/portal/sale/video/upload/index.vue:99-101`（`canvas.toBlob` → `ossPut`） | — |
| Quill | `common/components/common/editor/quill/index.vue:305` | 34 个页面 |
| TinyMCE | `common/components/common/editor/tinymce/index.vue` | 8 处 |
| EditorJS | `components/portal/platform/document/block-editor/index.vue:15,53` | — |
| Craft | `common/components/common/craft-player/index.vue:54-57` | — |
| 合同块编辑器 | `app/portal/library/contract/components/ContractEditor/` | — |

`gridstack`、`three`、`vue-cropper` 在 `package.json` 中，portal 内无引用。

### 9.7 iframe 与消息协议

- BPM 流程引擎 iframe：`views/dashboard/common/frame/index.vue:3`，src 由 `route.query.flow|url` base64 解码 + 拼 `token/tenant/user/system/baseurl`（:47-83）
- 宿主监听 `message`（:163-164），处理 8 种 `data.type`：`LOGOUT`、`HOME`、`SALE_GO_CUSTOMER`、`SALE_CREATE_CREDIT`、`SALE_DETAIL_CREDIT`、`SETTING_TRANSFER`、`FLOW_SET_INFORMER`、`OPEN_NEW_PAGE`
- 生成器：`app/portal/utils/menu.js:9-25`，`ROUTE_FRAME_PATH = '/dashboard/frame'`，在 `menus/**` 中使用 49 处
- `@d2-framework/frame-messenger` + `common/libs/frame/index.js`（`getParentOrigin()` 使用 `window.location.ancestorOrigins`）
- Flutter 桥：`window.flutterMessage` / `FlutterSubmit` / `FlutterCancel` / `flutterNewWebView` / `flutterZhdjEnvironment` / `flutterUpload` / `flutterOnContractCreateFinish`，出现于 `views/simple/**/mobile/**` 十余处

### 9.8 存储

| 存储 | 用途 | 位置 |
| --- | --- | --- |
| cookie `_vid` 前缀项 | 登录 token、tenant、language、menuPath、ignorePermission | `app/portal/utils/storage.js:9-20` |
| localStorage | 指纹 `_vid`、字典缓存 `portal:dict-hr` / `portal:dict-platform`、`bridge-<id>` | `common/utils/finger.js:5`、`system.js:73-93` |
| sessionStorage | 列表筛选状态、流程发起页状态、反向任务状态 | 22 处 |
| IndexedDB | 仅指纹缓存：库 `_fp_store`、store `kv`、key `vid` | `common/utils/finger.js:26-78` |

指纹实现（`common/utils/finger.js`）：动态注入 `<script src="/scripts/common/fingerprint/iife.min.js">`，读 `window.FingerprintJS`，双写 localStorage + IndexedDB。指纹**不参与请求签名**，仅作为登录参数 `deviceCode` 传给后端（`views/simple/common/login/index.vue:147,170`）。

### 9.9 观察者与定时器

| API | 位置 |
| --- | --- |
| `IntersectionObserver` | `views/dashboard/hr/message/components/hooks/useMessageList.js:105`（消息懒加载） |
| `ResizeObserver` | 10 个文件，含 `library/contract/components/ContractReader/index.vue:562-568`（合同 A4 分页测量） |
| `MutationObserver` | `common/utils/spy.js:43-50`；`views/dashboard/hr/flow/form/detail/index.vue:310`（按钮挂载位置） |
| `requestAnimationFrame` | `ChatConversation.vue:429`（已做降级）、`ContractReader/index.vue:516,553` |
| `requestIdleCallback` | `common/utils/finger.js:59-65`（有 `setTimeout` 降级） |
| 1s 轮询 | `system.js:53-69`（读 cookie `refreshMark` 同步多标签页） |
| 10s 轮询 | `app/portal/hooks/use-build-version-guard.js:99`（比对 `build.json`） |

---

## 10. 日志与请求录制现状

**[代码引用]**

`common/utils/logger.js` 定义了请求序列化器：

```js
// logger.js:23-53
function transformAxiosConfigToString (config) {
  const data = { baseURL, url, method, timeout, data, params, withCredentials }
  return JSON.stringify(data)
}
```

上传目标：`POST /adminmanage-api/system/web-operation-log/batchInsert`（`logger.js:271`），由 `setInterval(..., 1000)` 触发（`logger.js:120-122`）。

**但 `axiosConfig` 只在错误路径被采集**：`createRecord({...axiosConfig})` 的调用点为 `logger.js:165`（`window.onerror`）、`:186`（`unhandledrejection`）、`:199`、`:248`（`console.$log`）、`:256`（`console.$warn`）。

慢接口录制在 `app/portal/utils/http/tools.js:16` 被注释：

```js
//   axiosConfig: response.config,
// 暂时不再记录慢接口 防止恶性循环导致系统崩溃
```

结论：后端 `web-operation-log` 表为**错误/手动日志表**，不是全量请求日志。

后台查看页：`app/portal/views/dashboard/platform/system/log/web/list.vue`（含 `finger` 字段筛选），详情面板 `.../components/Panel.vue`（含 `record.axiosConfig`）。

埋点：`common/utils/spy.js` 动态注入 `/scripts/common/o-spy/2.2.9/index.min.js`，入口在 `components/portal/layout/index.vue:80,180,406-408`（「报告问题」菜单）。

---

## 11. 实测：模块在 Node 中的加载情况

**[实测]**

方法：编写 Node 自定义 resolver hook 处理 `common` / `app` 别名（不改动仓库文件），逐个 `import` 目标模块。

### 11.1 加载成功

| 模块 | 结果 |
| --- | --- |
| `common/libs/renren/config.js` | 导出 `config, options, setListPageModuleConfig, setRenrenConfig` |
| `common/libs/renren/list-state.js` | 导出 `clearListPageStateCache, createListPageStateCache, ...` |
| `app/portal/utils/finance/report-summary.js` | 导出 8 个 `normalize*` / `format*` 函数 |
| `common/utils/fetch.js` | 导出 `loopFetch` |
| `common/utils/number.js` | 导出 `numberFormat` 等 7 个函数；`numberFormat(1234.567, 2) = 1234.57` |
| `common/utils/array.js` | 导出 `filterTree` 等 |
| `common/utils/string.js` | 导出 `id8`、`projectSign` 等 |
| `app/portal/utils/http/tools.js` | 导出 `addStartTime, checkSlowAPI` |
| `app/portal/utils/http/sign.js` | 导出 `addSign`，调用成功 |
| `common/libs/renren/list.js` | **需补 vue-router + message 两个桩后加载成功**，导出 `useListPageModule` 等 7 项 |

### 11.2 加载失败及原因

| 目标 | 报错 |
| --- | --- |
| `app/portal/utils/http/platform.js` | `Cannot find package 'common'`（别名）→ 补别名后：`Unknown file extension ".jsx"` for `common/libs/modal/index.jsx` |
| `app/portal/utils/http/product.js` | 同上 |
| `app/portal/utils/system.js` | 同上 |
| `common/libs/renren/list.js`（无桩时） | `Cannot find module '.../common/utils/message'`（无扩展名 import） |
| `common/utils/browser.js`（经 logger 链） | `navigator is not defined`（模块顶层取值） |

### 11.3 调用 `useListPageModule` 的实测

- 在无 Vue 上下文时调用：`inject() can only be used inside setup()` 警告，随后抛 `Cannot read properties of undefined (reading 'history')`（`list.js:258`）
- 在 `createSSRApp` + `renderToString` 的 setup 中调用：同样抛 `Cannot read properties of undefined (reading 'history')`（桩 router 未提供 `history`）

### 11.4 测试套件实测

命令：`node --test $(find app/portal common app/zhdj-admin -name "*.test.mjs" -o -name "*.test.js")`（Node v22.22.3）

```
# tests 327
# pass 320
# fail 7
```

测试文件共 148 个，按内容分两类：

| 类型 | 数量 | 特征 |
| --- | --- | --- |
| 真实逻辑测试（import 实际模块并断言） | 82 | 例如 `views/dashboard/sale/visit/visit-list/components/customer-select-modal.test.mjs` import `./customer-select-modal.js` |
| 源码正则断言（`readFileSync` 读 `.vue` 文本做匹配） | 66 | 例如 `views/dashboard/finance/value-added/calculation/inventory-detailed-report/list.test.js:16` |

单例实测：`node --test .../customer-select-modal.test.mjs` → 前 188 行断言通过，在第 189 行失败于 `6 !== 3`（断言失败，非环境失败）。

`package.json` 中无 `node --test` / `vitest` 相关 script。

### 11.5 测试目录中出现的模块形态

| 形态 | 示例 |
| --- | --- |
| `.vue` + 同名 `.js`（逻辑外提） | `CustomerSelectModal.vue`(32KB) + `customer-select-modal.js`(5.3KB) + `customer-select-modal-loader.js` |
| 纯 Node 测试 import Vue reactivity | `common/utils/hr/agreement-blocks/customer-visit-selection.test.mjs`：`import { nextTick, reactive, watch } from 'vue'` |

按「`.vue` 旁是否存在同名或 kebab-case 同名 `.js`」扫描：5,352 个 `.vue` 中命中 **7 个**。

---

## 12. 已有的静态提取先例

**[实测 + 代码引用]**

| 脚本 | 作用 |
| --- | --- |
| `scripts/flutter-route-audit.mjs` | 静态解析 Flutter 源码中的 `_Paths` / `Routes` 常量与 `Get.to` 类调用，产出路由对照 CSV |
| `scripts/build-app-route-document.mjs` | 将审计结果转换为 Markdown 路由文档 |

产出物：

- `docs/flutter-route-audit/APP_ROUTES.md`（1,362 行）
- `docs/flutter-route-audit/app-routes.csv`（1,357 行）
- `docs/flutter-route-audit/XIAOHUI_ROUTES.md`（143 行）
- `docs/flutter小慧/网页打开URL清单.md`（按 agentType 1-30 列出每个卡片打开的 URL）

`vite.config.js:151` 的 `onRoutesGenerated: projectRoutes`（实现于 `build/utils/page.js:4-17`）在构建期对生成的路由按 app 分组并剥离前缀。

---

## 13. 分析过程中的方法限制

1. **接口路径计数**：正则提取字面量，运行时拼接的 URL 未计入
2. **`customLoad` 函数体扫描**：只识别了 6 个约定命名的函数（`actionGetPageCountAndList` 等），箭头函数内联形式未计入统计的 188 之外部分
3. **第 1.3 节 script 行数分布**、**第 9 节部分条目**、**第 7 节部分条目**由子代理静态扫描产出，本次未独立复算
4. **Node 加载实测**使用了临时编写的 resolver hook（位于 `/tmp`，未改动仓库），与最终构建链（Vite + 别名 + 虚拟模块）不等价
5. **未在真实浏览器中执行任何页面**，所有运行期行为推断均来自源码阅读
6. 仓库分支为 HEAD（`f096a38fb4`），后续提交可能使部分行号失效
