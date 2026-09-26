/**
 * 写操作 → 基础数据失效 的证据表。
 *
 * 来源：Portal 前端仓库（当时读的是 `/Users/liyang/Documents/code/wdbc/Projects_Js`；
 * 2026-09-22 起参考来源换成 `CodeReview_Projects_Js`，见 `docs/conventions.md` 第 32 条 ——
 * **下面各条的行号仍是在旧检出上读的，未在新检出复核**）里
 * 「哪次写之后重取了什么基础数据」的真实调用点。方法见设计文档 §1c 那条线的说明，
 * 值得先记下来的三条结论：
 *
 * 1. **前端主动失效的地方本来就极少。** 按设计文档的统计，写成功后 1,390 处 `message.success`、
 *    1,621 处列表刷新，而缓存失效只有 15 处、其中一半在 `logout()`。所以这张表**长不了**，
 *    剩下那 1,600 多处写操作是"列表自己刷新了、公共基础数据没刷新"——那是前端的既有缺口，
 *    不是 SDK 可以照抄的行为。SDK 侧的正确做法是：只要写操作改了某个基础数据 key 的**数据源**，
 *    就必须失效它，哪怕浏览器里没这么做。
 * 2. **前端有两条惯用法**，找证据时认这两个：
 *    - `xxxStore.ready = false` + `await fetchXxx()`（字典走的这条）；
 *    - `fetchXxx(true)`（租户开通系统走的这条，`force` 是唯一的重取开关）。
 *    `fetchOrganization()` 没有 `force` 参数（`system.js:844-849`），且机构树不在
 *    `BASE_DATA_REGISTRY` 的六个 key 里，所以它进不了这张表——见文件末尾的"查不到证据"。
 * 3. **`dict-hr` 与 `dict-platform` 在 Portal 当前版本里同源**（都是
 *    `GET /admin-api/system/dict-data/grouped-list`，`system.js:196 / 315`）。
 *    页面写后只重取一次（`fetchAllDicts`），但同一份 payload 一起变旧，所以两个 key 一起失效。
 *
 * ⚠️ 本文件里的行号是**在某个 Portal 版本上量出来的**。前端改动后行号会漂，
 * 但 `code` 字段摘录的语句一般还在——核对不上时按 code 重新定位，别直接删规则。
 */

import { PORTAL_BASE_DATA_KEYS } from '../session/base-data.js'
import type { WriteInvalidationRule } from './types.js'

const { tenantContext, tenantSystem, securityConfig, dictHr, dictPlatform } = PORTAL_BASE_DATA_KEYS

/** 字典数据写入共同影响的 key。见文件头第 3 条：两个 key 同源 */
const DICT_KEYS = [dictHr, dictPlatform] as const

/**
 * 组织树的 key。**它不在 `PORTAL_BASE_DATA_KEYS` 里**——组织树要不要进会话缓存是
 * 一个还没拍板的设计决定（见本文件末尾「组织树与第 7 个 key」）。
 *
 * 先给它一个稳定的名字，是为了让下面这组规则在决定落地时不用重写：
 * - 若决定加：把它注册进 `PORTAL_BASE_DATA_KEYS`（键名保持一致），规则即可生效；
 * - 若决定不加：把这组规则的 `keys` 改成 `[]`（它们仍然是"已核查过"的记录）。
 *
 * 在决定落地**之前**，`applyInvalidation` 会把这个 key 报进 `absent`——因为会话里
 * 根本没有这个 key。这是如实的：它没有被清掉，是因为它从来就没被缓存过。
 */
export const ORG_TREE_KEY = 'org-tree'

export const WRITE_INVALIDATION_RULES: readonly WriteInvalidationRule[] = [
  // -------------------------------------------------------------------------
  // 一、字典数据（/sys/dict/data）
  //
  // 前端唯一的"写后主动失效"在这里，而且是三处都写全了的：
  //   await http.post|put('/sys/dict/data', form)
  //   dictStore.ready = false          ← 失效
  //   await fetchAllDicts()            ← 重取
  // -------------------------------------------------------------------------

  {
    id: 'dict-data-create',
    trigger: '新增字典数据（字典项）',
    endpoints: [{ method: 'POST', path: '/sys/dict/data' }],
    keys: DICT_KEYS,
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/setting/dict/data/[type]/[mode]/[id].vue',
        lines: '55-61',
        code: "if (rrForm.isCreateMode) { await http.post('/sys/dict/data', form) } ... dictStore.ready = false; await fetchAllDicts()",
        note: '保存成功后立刻把自己那份字典 store 标脏并重取',
      },
      {
        file: 'app/portal/utils/system.js',
        lines: '315',
        code: "const result = await http('/admin-api/system/dict-data/grouped-list')",
        note: 'fetchAllDicts 取的就是 dict-hr 的数据源',
      },
      {
        file: 'app/portal/utils/system.js',
        lines: '196',
        code: "const result = await http('/admin-api/system/dict-data/grouped-list')",
        note: 'fetchAllPlatformDicts 取的是同一个接口 → dict-platform 同时变旧',
      },
    ],
    note: '页面只重取了 dict-hr，但 dict-platform 读的是同一个接口同一份 payload，必须一起失效',
  },

  {
    id: 'dict-data-update',
    trigger: '修改字典数据',
    endpoints: [{ method: 'PUT', path: '/sys/dict/data' }],
    keys: DICT_KEYS,
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/setting/dict/data/[type]/[mode]/[id].vue',
        lines: '58-61',
        code: "await http.put('/sys/dict/data', form) ... dictStore.ready = false; await fetchAllDicts()",
      },
      {
        file: 'app/portal/views/dashboard/hr/manage/protocol-configuration/list.vue',
        lines: '196-203',
        code: "await http.put('/sys/dict/data', { id, dictValue, dictLabel, dictTypeId }) ... dictStore.ready = false; await fetchAllDicts()",
        note: '第二个页面用同一套写法，说明这是前端成型的惯例而不是随手写的',
      },
    ],
  },

  {
    id: 'dict-data-update-list',
    trigger: '批量修改字典数据（按 id 批量改标签）',
    endpoints: [{ method: 'PUT', path: '/sys/dict/data/updateList' }],
    keys: DICT_KEYS,
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/education/base/teacher-appraise-setting/components/form.vue',
        lines: '182-184',
        code: "await http.put('/sys/dict/data/updateList', data); dictStore.ready = false; await fetchAllDicts()",
      },
      {
        file: 'app/portal/views/dashboard/hr/manage/protocol-configuration/list.vue',
        lines: '191-203',
        code: "await http({ url: '/sys/dict/data/updateList', method: 'PUT', data: dateDictList }) ... dictStore.ready = false; await fetchAllDicts()",
      },
    ],
  },

  {
    id: 'dict-data-delete',
    trigger: '删除字典数据',
    endpoints: [{ method: 'DELETE', path: '/sys/dict/data' }],
    keys: DICT_KEYS,
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/setting/dict/data/[type]/items.vue',
        lines: '73',
        code: "deleteURL: '/sys/dict/data'",
        note: '列表页的删除走通用 list 模块，走的是 deleteURL',
      },
      {
        file: 'common/libs/renren/list.js',
        lines: '517-521',
        code: 'const url = deleteIsBatch ? deleteURL : `${deleteURL}/${id}`; await _http.delete(url, { data: id ? [id] : selectState.value })',
        note: '确认最终请求是 DELETE + body 里的 id 数组',
      },
    ],
    note:
      '推断依据：与已确认的 POST/PUT 是同一个资源、同一份 grouped-list payload 的来源，' +
      '删除一定会改变它。但**前端删除后没有失效也没有重取**（只刷新本页列表），' +
      '所以拿不到"观察到重取"的直接证据。',
  },

  {
    id: 'dict-type-write',
    trigger: '新增 / 修改字典类型',
    endpoints: [
      { method: 'POST', path: '/sys/dict/type' },
      { method: 'PUT', path: '/sys/dict/type' },
    ],
    keys: DICT_KEYS,
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/setting/dict/[mode]/[id].vue',
        lines: '38-39',
        code: "useFormPageModule({ objectURL: '/sys/dict/type', ... })",
        note: '通用表单模块，整份文件没有任何字典刷新调用',
      },
      {
        file: 'common/libs/renren/form.js',
        lines: '132-136',
        code: 'else if (customSubmit) { ... await customSubmit(_form, ...) }',
        note: '没给 customSubmit 时直接走 objectURL，模块自己不碰基础数据',
      },
    ],
    note:
      '推断依据：字典类型是 grouped-list 里 `dictType` 的来源（新增类型会多出一项、改名会改 key）。' +
      '前端此处**完全没有重取**，属于前端缺口。',
  },

  {
    id: 'dict-type-delete',
    trigger: '删除字典类型',
    endpoints: [{ method: 'DELETE', path: '/sys/dict/type' }],
    keys: DICT_KEYS,
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/setting/dict/list.vue',
        lines: '71',
        code: "deleteURL: '/sys/dict/type'",
      },
      {
        file: 'common/libs/renren/list.js',
        lines: '517-521',
        code: 'await _http.delete(url, { ... })',
      },
    ],
    note: '同上：删除类型会连带让 grouped-list 少一组，前端未重取。',
  },

  // -------------------------------------------------------------------------
  // 二、安全配置（/adminmanage-api/adminmanage/platform-config）
  //
  // 页面是"写完整组再整组重读"，重读的正是 security-config 的数据源。
  // 注意它写回的是**页面局部 state**（syncConfigGroups），没有更新全局
  // useSecurityConfigStore —— 浏览器里全局那份也是旧的，SDK 侧更该失效。
  // -------------------------------------------------------------------------

  {
    id: 'security-config-update-values',
    trigger: '保存安全配置的值（整组开关/数值）',
    endpoints: [
      { method: 'PUT', path: '/adminmanage-api/adminmanage/platform-config/update-values' },
    ],
    keys: [securityConfig],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/list.vue',
        lines: '410-411',
        code: 'await http.put(platformConfigApi.updateValues, buildSavePayload(currentConfigs.value)); await loadConfigGroups()',
      },
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/list.vue',
        lines: '284-287',
        code: 'async function loadConfigGroups () { ... await http.get(platformConfigApi.list) }',
        note: '重读的就是 security-config 的数据源（system.js:135 同一个接口）',
      },
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/define.js',
        lines: '17-24',
        code: "const apiPrefix = '/adminmanage-api/adminmanage/platform-config'; updateValues: `${apiPrefix}/update-values`",
      },
    ],
    note: '页面重读只写回局部 state 并不同步全局 store，但"数据源变了"这件事是确定的',
  },

  {
    id: 'security-config-update',
    trigger: '修改安全配置项（元数据）',
    endpoints: [
      { method: 'PUT', path: '/adminmanage-api/adminmanage/platform-config/update' },
    ],
    keys: [securityConfig],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/list.vue',
        lines: '427-435',
        code: "if (editingConfig.id) { await http.put(platformConfigApi.update, ...) } ... await loadConfigGroups()",
      },
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/list.vue',
        lines: '284-287',
        code: 'await http.get(platformConfigApi.list)',
      },
    ],
  },

  {
    id: 'security-config-create',
    trigger: '新增自定义安全配置项',
    endpoints: [
      { method: 'POST', path: '/adminmanage-api/adminmanage/platform-config/create' },
    ],
    keys: [securityConfig],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/list.vue',
        lines: '429-435',
        code: 'else { await http.post(platformConfigApi.create, buildCreatePayload(editingConfig)) } ... await loadConfigGroups()',
      },
    ],
  },

  {
    id: 'security-config-delete',
    trigger: '删除自定义安全配置项',
    endpoints: [
      { method: 'DELETE', path: '/adminmanage-api/adminmanage/platform-config/delete' },
    ],
    keys: [securityConfig],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/platform/system/security-config/list.vue',
        lines: '476-478',
        code: 'await http.delete(platformConfigApi.delete, { params: { id: record.id } }); await loadConfigGroups()',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 三、租户上下文变化（不是"写数据"，但对基础数据的效果一样）
  // -------------------------------------------------------------------------

  {
    id: 'tenant-switch',
    trigger: '切换当前企业（换租户）',
    endpoints: [{ method: 'GET', path: '/admin-api/sys/createNewJwtToken' }],
    keys: [tenantSystem],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/common/chat/composables/useXiaohuiAgentActions.js',
        lines: '137-139',
        code: 'setToken(newToken.token); setCurrentTenantId(targetTenantId); await fetchTenantSystem(true)',
        note: '换租户 = 换 token + 换 tenantId，然后**强制**重取 tenant-system',
      },
      {
        file: 'app/portal/views/dashboard/common/chat/composables/useXiaohuiAgentActions.js',
        lines: '115-116',
        code: 'if (String(getCurrentTenantId() || \'\') === targetTenantId) { await fetchTenantSystem(true); return true }',
        note: '连"目标就是当前租户"这一支也要强制重取，说明它被当成"上下文可能变脏"的信号',
      },
      {
        file: 'app/portal/components/portal/layout/index.vue',
        lines: '361-368',
        code: 'async function changeTenant () { await startSelectTenantModal({ refreshToken: true }); ... window.location.reload() }',
        note: '顶栏那条路更狠：整页 reload，等于把所有缓存全废掉',
      },
    ],
    note:
      'SDK 里租户是会话键的一部分（src/session/types.ts:16-20），换租户 = 换会话，' +
      '天然不存在"要失效的旧租户缓存"。登记这条是为了说明：**前端把换租户当成全局失效信号**，' +
      '而 SDK 用会话键表达同一件事，所以这个写目标在 SDK 里没有调用面，' +
      '真有人通过 SDK 发这个请求时才会用到这条规则。',
  },

  {
    id: 'tenant-update-use-system',
    trigger: '平台侧开通/关闭某租户的系统',
    endpoints: [
      { method: 'PUT', path: '/adminmanage-api/system/tenant/update-use-system' },
    ],
    keys: [tenantSystem],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/platform/tenant/manage/[mode]/[id]_bat.vue',
        lines: '131-134',
        code: "await http.put('/adminmanage-api/system/tenant/update-use-system', { status, id: tenantId, selSystem }) ... prompt()",
        note: '写后只弹"编辑成功"，**没有任何基础数据重取**',
      },
      {
        file: 'app/portal/utils/system.js',
        lines: '673-678',
        code: "const result = await http('/admin-api/system/tenant/get', { params: { id: tenantId } }); const systemList = result.useSystem.split(',')",
        note: 'tenant-system 读的就是这个租户记录的 useSystem 字段',
      },
      {
        file: 'app/portal/utils/system.js',
        lines: '662-668',
        code: 'const isCurrentTenantReady = tenantSystemStore.ready && tenantSystemStore.loadedTenantId === tenantId; if (isCurrentTenantReady && !force) return',
        note: '只在换租户时按 loadedTenantId 判脏，同租户内的 useSystem 变化它看不见',
      },
    ],
    note:
      '推断依据：写接口改的字段（useSystem）与 tenant-system 读的字段是同一个。' +
      '拿不到"观察到重取"的证据——前端在这个页面上确实没重取，且这个页面主要改的是**别的**租户。' +
      'SDK 侧保守失效一次的成本很低，宁多不旧。',
  },

  {
    id: 'tenant-write',
    trigger: '平台侧新建 / 修改企业（租户记录）',
    endpoints: [
      { method: 'POST', path: '/adminmanage-api/system/tenant/create' },
      { method: 'PUT', path: '/adminmanage-api/system/tenant/update' },
    ],
    keys: [tenantContext],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/platform/tenant/manage/[mode]/[id].vue',
        lines: '126-138',
        code: "const url = rrForm.isCreateMode ? '.../tenant/create' : '.../tenant/update' ... message.success('保存成功')",
        note: '写后只成功提示，无重取',
      },
      {
        file: 'app/portal/utils/system.js',
        lines: '606-614',
        code: "loopFetch((pageNo, pageSize) => http.get('/admin-api/hr/system-tenant/getUserTenantsByPage', { params: { pageNo, pageSize } }), ...)",
        note: 'tenant-context 的数据源就是企业列表（id/name），改名/新建都会让它变',
      },
      {
        file: 'app/portal/views/dashboard/platform/tenant/manage/[mode]/[id].vue',
        lines: '82',
        code: 'form: { ... }',
        note: '表单里**没有** useSystem 字段，所以这条不影响 tenant-system，只影响 tenant-context 的列表内容',
      },
    ],
    note: '推断依据：企业与"当前用户可见企业列表"是同一份数据。前端未重取。',
  },

  // -------------------------------------------------------------------------
  // 四、SDK 现有写能力：已核查，确认不影响任何基础数据
  //
  // 空 keys 不是"没登记"，是"查过了、没有"。留着它，是为了让下一个人
  // 不必再把这两条链路重走一遍（也防止有人凭感觉给它们挂上一组 key）。
  // -------------------------------------------------------------------------

  {
    id: 'meeting-application-submit-no-impact',
    trigger: '提交会议室预定申请（创建 BPM 流程实例）',
    capabilityIds: ['meeting-application-submit'],
    endpoints: [{ method: 'POST', path: '/hr/meeting-application/create' }],
    keys: [],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/simple/hr/form/033/page/pc/edit/index.vue',
        lines: '390-393',
        code: "await http.post('/admin-api/hr/meeting-application/create', finalData); messageUtil.success('提交成功'); goBack()",
        note: '提交成功后直接回列表页，全程没有任何基础数据重取',
      },
      {
        file: 'app/portal/views/simple/hr/form/033/page/mobile/edit/index.vue',
        lines: '527-530',
        code: "await http.post(apiSubmit, finalData); message.success('提交成功'); appMessage('提交成功', ...)",
        note: '移动端同一支链路，同样没有重取',
      },
    ],
    note: '会议室占用（meeting-room-usage）不是基础数据 key，也不在会话缓存里，所以这里没有任何要失效的东西',
  },

  {
    id: 'meeting-application-cancel-no-impact',
    trigger: '取消会议室预定',
    capabilityIds: ['meeting-application-cancel'],
    endpoints: [{ method: 'PUT', path: '/hr/meeting-application/cancel-reservation/{id}' }],
    keys: [],
    confidence: 'confirmed',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/flow/task/my/list.vue',
        lines: '303-306',
        code: 'async onOk() { await http.put(`/hr/meeting-application/cancel-reservation/${id}`); message.success(\'取消预定成功\'); rrList.logicFetch() }',
        note: '只刷新本页任务列表，不碰基础数据',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 五、组织架构（/org/*）—— **全部是推测项**
  //
  // 先说结论：**找不到任何"org 写完之后前端重取了组织树"的证据**。
  // 逐页看过 org-setting（新建/修改/启用/停用/导入/变更隶属关系）、org-type、
  // corporation、post-setting、org-propType，没有一处出现 `fetchOrganization`、
  // `useOrganizationStore` 或 `getRoleOrganizationTree`。写后能观察到的"刷新"只有两种，
  // 都与组织树无关：
  //   - `rrList.actionFetch()`（`org-setting/list.vue:160,173`）——只刷本页列表；
  //   - `flagSet('init'|'fetch', true)` + `router.back()`（`org-setting/[mode]/[id].vue:473-476`）
  //     ——`common/libs/renren/list.js:50-57,648-662` 的**列表页自己的**重取标志。
  // 唯一会清组织树的地方仍是 `logout()`（`system.js:538`）。
  //
  // 那为什么还要登记？因为"前端没刷新"不等于"数据没变"：
  // `HrOrganizationDTO` 是组织树节点的真实形状，下面每条写接口改的字段都能在
  // 这个 DTO 里找到对应字段（后端仓库 `Mall_Platform_Java_Dev` 的 `dev` 分支，行号见各条 evidence；
  // 2026-09-22 起参考来源换成 `CodeReview_Mall_Platform_Java@test/test`，这些行号**未在新检出复核**）。
  // 字段同源 = 树会变旧，这是**推断**，不是观察，所以全部标 inferred。
  // -------------------------------------------------------------------------

  {
    id: 'org-organization-write',
    trigger: '新建 / 修改组织',
    endpoints: [
      { method: 'POST', path: '/admin-api/org/organization' },
      { method: 'PUT', path: '/admin-api/org/organization' },
    ],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/org-setting/[mode]/[id].vue',
        lines: '468-476',
        code: "if (rrForm.isCreateMode) { await http.post('/admin-api/org/organization', data) } else { await http.put('/admin-api/org/organization', data) } ... flagSet('fetch', true); router.back()",
        note: '写后只置列表页标志并返回，**没有任何组织树重取**',
      },
      {
        repo: 'Mall_Platform_Java_Dev',
        file: 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java',
        lines: '27-30',
        code: 'private Long id; private Long pid;',
        note: '组织树节点就是 HrOrganizationDTO，id/pid 决定它在树里的位置',
      },
    ],
    note: '推断依据：接口写的就是树节点本身的字段；前端未重取',
  },

  {
    id: 'org-organization-import',
    trigger: '批量导入组织',
    endpoints: [{ method: 'POST', path: '/org/organization/import' }],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/org-setting/components/create-multiple.vue',
        lines: '28-34',
        code: "const result = await http.post('/org/organization/import', formData, {...}); modalEmit('success', result); onSuccess()",
        note: '只把成功回调抛给父页面，父页面也不碰组织树',
      },
    ],
    note: '批量新建组织节点，树必然变；前端未重取',
  },

  {
    id: 'org-organization-status',
    trigger: '启用 / 停用组织',
    endpoints: [
      { method: 'POST', path: '/org/organization/enable/{id}' },
      { method: 'POST', path: '/org/organization/disable/{id}' },
    ],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/org-setting/list.vue',
        lines: '157-161',
        code: "await http.post(`/org/organization/disable/${record.id}`); message.success('停用成功'); rrList.actionFetch()",
        note: '只刷本页列表',
      },
      {
        file: 'app/portal/views/dashboard/hr/org/org-setting/list.vue',
        lines: '171-173',
        code: "await http.post(`/org/organization/enable/${record.id}`); message.success('启用成功'); rrList.actionFetch()",
      },
      {
        repo: 'Mall_Platform_Java_Dev',
        file: 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java',
        lines: '148',
        code: 'private Integer status;',
        note: 'status 是树节点字段；后端另有 getRoleOrganizationTreeNew 的启用过滤测试，说明新树接口确实按启用状态过滤',
      },
    ],
    note: '推断依据：status 是节点字段；前端未重取',
  },

  {
    id: 'org-organization-belong-relation',
    trigger: '变更组织隶属关系',
    endpoints: [{ method: 'PUT', path: '/org/organization/updateBelongRelation' }],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/org-setting/components/change-relation.vue',
        lines: '84-91',
        code: "await http.put('/org/organization/updateBelongRelation', formState); message.success('保存成功'); modalEmit('success')",
        note: '只通知弹层调用方，父页面不重取组织树',
      },
    ],
    note: '这条改的就是 pid/层级关系（树结构本身）；前端未重取',
  },

  {
    id: 'org-type-write',
    trigger: '新增 / 修改组织类型',
    endpoints: [{ method: 'POST', path: '/org/organizationType/save' }],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/org-type/[mode]/[id].vue',
        lines: '38',
        code: "await http.post('/org/organizationType/save', form)",
      },
      {
        repo: 'Mall_Platform_Java_Dev',
        file: 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java',
        lines: '42-45',
        code: 'private List<Long> typeList; private String type;',
        note: '组织类型是树节点的字段',
      },
    ],
    note: '推断依据：type/typeList 是节点字段；前端未重取',
  },

  {
    id: 'org-corporation-write',
    trigger: '新增 / 修改法人公司',
    endpoints: [{ method: 'POST', path: '/org/corporation/save' }],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/corporation/[mode]/[id].vue',
        lines: '57',
        code: "await http.post('/org/corporation/save', payload)",
      },
      {
        repo: 'Mall_Platform_Java_Dev',
        file: 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java',
        lines: '75-81',
        code: 'private Integer isCorporation; private Long corporation; private HrLegalPersonDTO hrLegalPersonDTO;',
        note: '法人信息是树节点字段（前端 level 表里"法人"是第 4 级）',
      },
    ],
    note: '推断依据：法人相关字段在树节点上；前端未重取',
  },

  {
    id: 'org-post-write',
    trigger: '新增 / 修改岗位',
    endpoints: [{ method: 'POST', path: '/org/hrpost/save' }],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/post/post-setting/[mode]/[id].vue',
        lines: '139',
        code: "await http.post('/org/hrpost/save', formSubmit)",
      },
      {
        file: 'app/portal/components/portal/hxr/search-col-group/organization/index.vue',
        lines: '33-41',
        code: "const groupData = [ { level: 2, label: '板块' }, ..., { level: 8, label: '岗位' } ]",
        note: '**岗位是组织树的第 8 级**——这是"改岗位会改组织树"的关键证据，而且是前端自己写的层级表',
      },
      {
        repo: 'Mall_Platform_Java_Dev',
        file: 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java',
        lines: '167-185',
        code: 'private List<HrOrganizationPostDTO> jobList; private Integer isHavePost; private String containJob; private Integer postNeedCount;',
      },
    ],
    note: '推断依据：岗位是树的第 8 级节点；前端未重取',
  },

  {
    id: 'org-property-write',
    trigger: '新增 / 修改组织属性（含启用停用）',
    endpoints: [
      { method: 'POST', path: '/admin-api/hr/org/organizationProperty/save' },
      { method: 'POST', path: '/admin-api/hr/org/organizationProperty/updateStatus' },
    ],
    keys: [ORG_TREE_KEY],
    confidence: 'inferred',
    evidence: [
      {
        file: 'app/portal/views/dashboard/hr/org/org-propType/[mode]/[id].vue',
        lines: '42',
        code: "await http.post('/admin-api/hr/org/organizationProperty/save', form)",
      },
      {
        file: 'app/portal/views/dashboard/hr/org/org-propType/list.vue',
        lines: '108-117',
        code: 'await http.post(`/admin-api/hr/org/organizationProperty/updateStatus`, {...})',
      },
      {
        repo: 'Mall_Platform_Java_Dev',
        file: 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java',
        lines: '48',
        code: 'private List<Long> propertyList;',
        note: '组织属性挂在树节点上',
      },
    ],
    note: '推断依据：propertyList 是节点字段；前端未重取。这条最弱——属性是"可选配置"，很多租户根本没用',
  },
]

// ---------------------------------------------------------------------------
// 组织树与"第 7 个 key"（事实，供拍板用）
// ---------------------------------------------------------------------------
//
// **`fetchOrganization()` 的事实**（`app/portal/utils/system.js:844-849`）：
//   - 接口：`GET /org/organization/getRoleOrganizationTree`（裸路径，前端拦截器
//     `app/portal/utils/http/platform.js:19-24` 补 `/admin-api`，与 SDK 的
//     `src/http/client.ts:58-61` 是同一条规则 → 线上是 `/admin-api/org/organization/...`）
//   - 参数：**没有**。没有分页、没有 force、没有 module-type 显式传参。
//   - 缓存：一个模块级布尔 `organizationStore.ready`。清它的地方只有 `logout()`
//     （`system.js:538`）；整页 reload 自然清空。
//   - 调用点：`app/portal/utils/router/session.js:52`（全量初始化链的 10 个并发请求之一），
//     以及 `simple/hr/form/031` 这类页面进入时的 `await fetchOrganization()`。
//   - 形状：后端 `Result<List<HrOrganizationDTO>>` 经 `TreeUtils.build` 拼成树
//     （`Mall_Platform_Java_Dev:.../HrOrganizationController.java:282-291`），
//     即 `{ code, data: [{ id, pid, name, ..., children: [...] }], msg }`。
//
// **为什么它比六个 key 都重**：
//   - 节点含约 60 个字段（`HrOrganizationDTO.java:24-203`），其中 `jobList` /
//     `partTimeJobList` / `hrLegalPersonDTO` / `hrOrganizationLicenseDTOList` 都不小；
//   - 超管与租户管理员直接拿**整个租户的 8 级全树**、无过滤无分页
//     （`HrOrganizationServiceImpl.java:2859-2863`；`getOrgIdListByModuleType` 的
//     租户管理员分支 `:5309-5313`）；
//   - 树一直下探到**岗位**（第 8 级，`search-col-group/organization/index.vue:33-41`）。
//
// **它有一个别的 key 没有的维度：module-type。** 控制器把请求头里的 module-type 写进
// LoginUser（`HrOrganizationController.java:286-288`），而权限组织集是按它算的
// （`HrOrganizationServiceImpl.java:5315-5331`：用 `user.getModuleType()` 去查
// `getRoleModuleListByUserIdAndTenantId(..., currentModuleType, ...)`）。也就是说
// **同一个用户在不同模块下拿到的组织树不一样**。
// 运行时也能看到这一点：测试环境首页**一次加载发了 9 个组织树形状的请求**——
// `getRoleOrganizationTree` ×3、`getRoleOrganizationTreeNew?excludePost=false` ×2、
// `getRoleOrganizationTreeFinanceModule?adjustRootLevel=true&moduleType=21|22|24|26` ×4
// （只读观察 `bsk network`，2026-09-20；单次 591ms）。而 SDK 的基础数据默认**不带**
// module-type（D34）。→ 结论写在 `ORG_TREE_KEY` 的注释里：**要缓存就得把 module-type
// 并进键**，不能照抄六个 key 的 `(user, tenant, lang)`。
//
// ---------------------------------------------------------------------------
// 找不到证据的写操作（**不要凭感觉补规则**，列在这里是诚实的边界）
// ---------------------------------------------------------------------------
//
// 0. **组织树的写操作**：写入口找到了（`org/*`，见上面第五节），但**"写后重取组织树"
//    的证据一条都没有**——所以那 8 条全部是 `inferred`，没有一条确定项。
//    附带一个反例：`POST /admin-api/org/organization/checkCanDisable/{id}`
//    （`org-setting/list.vue:152`）虽然长得像写，其实是**读**（把返回值当确认弹窗的文案），
//    没有登记。
// 1. **org 家族里我判不准、因此没登记的**：`/org/hrposttype/save`（岗位类型）、
//    `/org/hrsalarylevel/save`（薪资级别）——`HrOrganizationDTO` 里找不到对应字段；
//    `/org/staff`、`/org/outsideStaff`、`/org/staff/{id}/post-transfer/import`（员工）、
//    `/org/hrWorkSchedule*`、`/org/hrAttendanceSheet/saveSheet`、`/org/holiday/*`（考勤）、
//    `PUT /org/sensitive`（敏感词）、`POST /org/post/role`（岗位配角色）——都不是树的节点内容。
//    其中"员工变动会改 `postNeedCount`/`userCount` 这类统计字段"这点我**没有证据**，不硬编。
// 2. **用户基础信息（user-basic，`/sys/user/info`）**：Portal 里搜不到任何写
//    `/sys/user/*` 的页面（只有读），`LoginInfoPanel.vue:82` 是**进页面时**
//    `fetchSimpleUserBasic({ force: true })`，不是写后。→ 没有可映射的写目标。
//    真正会改用户信息的是后端/别的系统，SDK 侧只能靠 TTL 兜。
// 3. **权限（`permissionsNotBySystem`）**：全仓库只有 `system.js:697` 一处读，
//    没有任何页面在写完之后重取；`fetchPermissions(force)` 的唯一强制调用点是
//    `fetchSaleAllState`（`system.js:1293`），而它的调用者 `changeShopUpdateData`
//    是**切店铺**（换 token，`system.js:1263-1279`），也不是基础数据写操作。
//    而且权限不在 `BASE_DATA_REGISTRY` 的六个 key 里。→ 无映射。
// 4. **敏感词、门店、区域、品牌、销售用户等其余 store**：同上，都不在基础数据 key 里
//    （本表只覆盖 `PORTAL_BASE_DATA_KEYS` 六个 key + 候选的 `ORG_TREE_KEY`），未登记。
// 5. **平台侧"开通/关闭租户"（`/adminmanage-api/system/tenant/open|close`，
//    `platform/tenant/manage/list.vue:165`）**：写的是租户自身的状态，页面写后只刷新本页列表。
//    它与 `tenant-context`（当前用户可见企业列表）是否相关取决于后端过滤口径，
//    前端看不出来 → 未登记。
