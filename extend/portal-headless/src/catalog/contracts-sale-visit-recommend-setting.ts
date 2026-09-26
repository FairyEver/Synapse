import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  SALE_VISIT_RECOMMEND_SETTING_METHODS,
} from '../capabilities/sale-visit-recommend-setting.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const formInput = input(
  '推荐设置页面表单；包含提前推送时间、拜访单晚交时间、推荐总数占比、商务类比服务类以及关键日龄设置数组。',
  '用户明确填写的页面字段；编辑已有设置时先使用sale-visit-recommend-setting-get的结果转换为表单，再只覆盖用户要改的值。',
  {
    type: 'object',
    nullable: false,
    constraints: [
      'advancePushDays和visitLateSubmitDays必须是1至29的整数；totalPercent必须是0至100的整数。',
      'keyDayItems至少一项；每项keyDay是大于等于0的整数，pushPoint去除首尾空白后必填且最多100个汉字；关键日龄不能重复。',
      'businessServiceRatio来自Portal字典business_analog_services；页面允许清空，清空按空字符串提交，SDK不猜测字典选项含义。',
    ],
  },
)

const formInputs: Record<string, AiParameter> = {
  form: formInput,
  'form.advancePushDays': input('提前多少天将双赢协议任务中的待拜访客户推送至业务管理。', 'form.advancePushDays；对应页面“提前推送时间”，单位为天。', { type: 'integer', constraints: ['整数1至29。'] }),
  'form.visitLateSubmitDays': input('拜访时间确定后，超过多少天不再显示拜访入口。', 'form.visitLateSubmitDays；对应页面“拜访单晚交时间”，单位为天。', { type: 'integer', constraints: ['整数1至29。'] }),
  'form.totalPercent': input('推荐总数占候选总数的百分比。', 'form.totalPercent；对应页面“推荐总数占比”，按页面原值提交，不换算为小数。', { type: 'integer', unit: '百分比点', constraints: ['整数0至100；例如20表示20%。'] }),
  'form.businessServiceRatio': input('商务类与服务类的占比字典值。', 'form.businessServiceRatio；来自页面business_analog_services字典选择，或用户清空后的null/省略。', { type: 'string | null', required: false, nullable: true, nullMeaning: '页面未选择占比；prepareSave转为空字符串提交。', omitted: '按页面默认/当前表单值处理；若明确不选择则传null。', constraints: ['字典候选和标签由Portal运行时提供，本能力不把任意字符串解释成固定比例。'] }),
  'form.keyDayItems': input('关键日龄设置数组；页面“添加关键日龄”增加一项，“删除”只改变本地数组。', 'form.keyDayItems；用户填写或从get结果转换得到。', { type: 'array', constraints: ['至少一项；关键日龄值不能重复。'] }),
  'form.keyDayItems[]': input('一项关键日龄设置对象。', 'form.keyDayItems中的一个元素。', { type: 'object' }),
  'form.keyDayItems[].keyDay': input('触发推荐推送要点的关键日龄。', 'form.keyDayItems[].keyDay；页面输入框原值。', { type: 'integer', constraints: ['整数且大于等于0；页面没有上限。'] }),
  'form.keyDayItems[].pushPoint': input('该关键日龄对应的推荐推送要点。', 'form.keyDayItems[].pushPoint；页面文本域输入。', { type: 'string', constraints: ['去除首尾空白后不能为空，最多100个汉字；提交时发送去除首尾空白后的值。'] }),
}

const draftInputs: Record<string, AiParameter> = {
  draft: input('prepareSave返回的最终POST请求体；不要自行把业务单据ID、租户ID或后端字段补入。', 'sale-visit-recommend-setting-prepare-save返回的result.draft。', { type: 'object' }),
  'draft.setting': input('最终请求体中的推荐设置对象。', 'draft.setting。', { type: 'object' }),
  'draft.setting.id': input('推荐设置记录ID占位字段。', 'SDK按Portal页面固定发送的0；后端按当前租户查找记录，非新增页面输入。', { type: 'integer', constraints: ['固定为0。'] }),
  'draft.setting.advancePushDays': input('最终请求中的提前推送天数。', 'draft.setting.advancePushDays。', { type: 'integer', constraints: ['1至29。'] }),
  'draft.setting.visitLateSubmitDays': input('最终请求中的拜访单晚交天数。', 'draft.setting.visitLateSubmitDays。', { type: 'integer', constraints: ['1至29。'] }),
  'draft.setting.recommendRatio': input('最终请求中的推荐总数百分比。', 'draft.setting.recommendRatio，由form.totalPercent映射。', { type: 'integer', unit: '百分比点', constraints: ['0至100。'] }),
  'draft.setting.businessServiceRatio': input('最终请求中的商务类比服务类字典值。', 'draft.setting.businessServiceRatio，由form.businessServiceRatio的null/省略转为空字符串。', { type: 'string' }),
  'draft.keyAgeSettings': input('最终请求中的关键日龄设置数组。', 'draft.keyAgeSettings，由form.keyDayItems映射。', { type: 'array', constraints: ['至少一项；关键日龄不能重复。'] }),
  'draft.keyAgeSettings[]': input('最终请求中的一项关键日龄设置。', 'draft.keyAgeSettings中的一个元素。', { type: 'object' }),
  'draft.keyAgeSettings[].id': input('关键日龄记录ID占位字段。', 'SDK按Portal详情响应不含行ID这一事实固定发送的0。', { type: 'integer', constraints: ['固定为0；不能把推荐设置ID或关键日龄值当作此ID。'] }),
  'draft.keyAgeSettings[].keyAge': input('最终请求中的关键日龄。', 'draft.keyAgeSettings[].keyAge，由form.keyDayItems[].keyDay映射。', { type: 'integer', constraints: ['大于等于0。'] }),
  'draft.keyAgeSettings[].pushPoint': input('最终请求中的推送要点。', 'draft.keyAgeSettings[].pushPoint，由form.keyDayItems[].pushPoint去除首尾空白后映射。', { type: 'string', constraints: ['非空，最多100个汉字。'] }),
}

const detailFields: AiField[] = [
  field('$', 'object', '当前租户的推荐设置详情。'),
  field('setting', 'object', '推荐设置主配置；没有主配置时SDK归一为null。', { nullable: true, nullMeaning: '当前租户没有已保存的主推荐设置；不是请求失败。' }),
  field('setting.advancePushDays', 'integer', '提前推送天数；页面以天为单位显示。', { nullable: true, nullMeaning: '后端未提供该值；页面表单保留空值。' }),
  field('setting.visitLateSubmitDays', 'integer', '拜访单晚交天数；页面以天为单位显示。', { nullable: true, nullMeaning: '后端未提供该值；页面表单保留空值。' }),
  field('setting.recommendRatio', 'integer', '推荐总数占比原值；20表示20%，SDK不换算为0.2。', { nullable: true, unit: '百分比点', nullMeaning: '后端未提供该值；页面表单保留空值。' }),
  field('setting.businessServiceRatio', 'string', '商务类与服务类占比的Portal字典值；SDK不把字典值翻译为固定比例。', { nullable: true, nullMeaning: '后端未提供占比或未选择。' }),
  field('keyAgeSettings', 'array', '当前租户关键日龄设置；后端null/缺失由SDK归一为空数组。', { nullable: false, constraints: ['数组顺序沿用后端查询顺序。'] }),
  field('keyAgeSettings[]', 'object', '一项关键日龄设置；详情响应不含可用于保存的行ID。'),
  field('keyAgeSettings[].keyAge', 'integer', '关键日龄原值。', { nullable: true, nullMeaning: '后端记录未提供关键日龄；不能作为合法保存值。' }),
  field('keyAgeSettings[].pushPoint', 'string', '该关键日龄的推送要点原值。', { nullable: true, nullMeaning: '后端记录未提供推送要点；不能作为合法保存值。' }),
]

const draftFields: AiField[] = [
  field('$', 'object', '推荐设置保存接口最终接收的完整请求体。'),
  field('draft', 'object', 'prepareSave产生的待提交对象。'),
  field('draft.setting', 'object', '推荐设置主配置请求对象。'),
  field('draft.setting.id', 'integer', '固定为0的记录ID占位字段；后端按当前租户更新或新增。'),
  field('draft.setting.advancePushDays', 'integer', '提前推送天数。'),
  field('draft.setting.visitLateSubmitDays', 'integer', '拜访单晚交天数。'),
  field('draft.setting.recommendRatio', 'integer', '推荐总数占比百分比点。'),
  field('draft.setting.businessServiceRatio', 'string', '商务类比服务类字典值；未选择时为空字符串。'),
  field('draft.keyAgeSettings', 'array', '关键日龄设置请求数组。'),
  field('draft.keyAgeSettings[]', 'object', '关键日龄设置请求对象。'),
  field('draft.keyAgeSettings[].id', 'integer', '固定为0的关键日龄记录ID占位字段。'),
  field('draft.keyAgeSettings[].keyAge', 'integer', '关键日龄。'),
  field('draft.keyAgeSettings[].pushPoint', 'string', '去除首尾空白后的推送要点。'),
]

const boolOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'boolean', '后端保存接口返回true；只表示保存请求成功受理，不表示页面配置已经被独立回读确认。', { values: { true: '保存请求成功' } })],
  empty: '不会返回空值或保存后的详情；非true回执会抛错。',
}

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:acab69acc7 app/portal/menus/sale.js; app/portal/views/dashboard/sale/visit/recommend-setting/list.vue',
    kind: 'reference',
    note: '源码锁定菜单路径、权限、platform.js实例、纯表单无列表筛选、GET/POST路径、默认值、校验、动态字典字段、添加/删除本地关键日龄和保存后重新GET。不是浏览器网络实测。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:0f1a55718eb RecommendSettingController/RecommendSettingServiceImpl/RecommendSettingWithAgeReqVO/RecommendSettingSaveReqVO/KeyAgeSettingSaveReqVO/RecommendSettingDetailRespVO',
    kind: 'reference',
    note: '源码锁定后端权限、请求字段、1至29/0至100/非负/100字校验、当前租户覆盖保存、关键日龄整表删除后批量插入和详情响应字段；保存回执为true。不是部署环境实测。',
  },
  {
    source: 'generated/page-catalog.json item 21c544; generated/module-type-rules.json type=60',
    kind: 'reference',
    note: '锁定页面为自定义写页面、permission和module-type=60；生成物未在本任务中修改。',
  },
  {
    source: 'src/capabilities/sale-visit-recommend-setting.ts',
    kind: 'implementation',
    note: '锁定platform请求实例、字段投影、页面载荷键名、固定id=0、表单校验和true回执。',
  },
  {
    source: 'test/sale-visit-recommend-setting.test.ts',
    kind: 'test',
    note: '离线夹具锁定源码锚点、请求路径/载荷、响应归一、非法输入、platform头、AI契约和反证；未发真实网络请求。',
  },
]

const commonBoundaries = [
  '只对应Portal路径 /dashboard/sale/visit/recommend-setting/list、权限 /dashboard/sale/frame/visit/recommendSetting、platform实例和module-type=60。',
  '该页面虽然路径以/list结尾，但不是分页列表；页面没有列表查询、筛选、删除后端接口或独立关键日龄推送查询入口。Controller中的key-age/push-point接口不是本页可达页面动作，未注册为本页能力。',
  '“删除”只从当前页面本地keyDayItems数组移除；保存时后端会按当前租户删除旧关键日龄并批量插入提交数组，不能把本地删除理解为单行可恢复删除。',
]

const commonFailures = [
  '表单字段类型、范围、关键日龄为空/重复、推送要点为空或超过100个汉字时，SDK在发请求前失败；应修正后重新prepare，不发送save。',
  '权限、会话、租户、网络或后端业务错误必须抛出，不能把页面默认值或空数组当成读取成功；读取异常时不要用默认值覆盖服务端数据。',
  'save返回非true时保存结果不成立；请求超时或连接中断时最终状态不确定，必须先调用get逐字段回查，未确认前不得盲目重试。',
]

const contracts: Record<string, AiContract> = {
  'sale-visit-recommend-setting-get': {
    purpose: '读取当前租户推荐设置表单的主配置和关键日龄设置，供展示、编辑和保存后的状态核对。',
    whenToUse: '用户要查看或修改推荐推送规则，或save成功/超时后需要核实服务端最终值时使用；它不是推荐客户列表查询。',
    boundaries: commonBoundaries,
    effect: 'read',
    prerequisites: ['使用带会话token和tenant-id的SDK，并具备页面权限；tenant-id决定读取的租户。'],
    inputs: {},
    output: { shape: 'object', fields: detailFields, empty: 'setting为null表示当前租户没有主配置；keyAgeSettings始终为数组，空数组表示没有关键日龄记录或详情响应没有返回该列表；网络/权限失败不会归一为空。' },
    consume: [
      '将setting.advancePushDays、setting.visitLateSubmitDays、setting.recommendRatio和setting.businessServiceRatio映射到对应表单；recommendRatio按百分比原值展示。',
      '将keyAgeSettings转换为keyDayItems；详情没有行ID，所以prepareSave会为每个提交项发送id=0。',
      '保存成功或超时后重新调用本能力，逐字段比较主配置和关键日龄数组；只收到save的true不能报告配置已生效。',
    ],
    steps: [
      { role: 'optional', when: '用户读取后要修改并保存', capabilityId: 'sale-visit-recommend-setting-prepare-save', instruction: '把recommendRatio改名为totalPercent，把keyAgeSettings[].keyAge/pushPoint转换为keyDayItems[].keyDay/pushPoint；再合并用户明确修改。' },
    ],
    completion: '返回当前租户主配置和关键日龄设置；空配置与空关键日龄会明确表示，不把读取成功解释为已有业务规则。',
    failures: commonFailures,
    idempotency: null,
    evidence,
    gaps: [
      '本轮未启动浏览器，未生成该页面脱敏baseline；platform实例、module-type=60和请求键/载荷来自固定Portal/Java源码与离线夹具，属于源码推断加离线实测，不是浏览器实测。',
      '真实测试环境smoke未执行；未在线验证当前租户实际详情、权限裁决、默认值或保存后的业务规则生效。',
      'Portal的business_analog_services字典候选由运行时组件提供，本能力未独立拉取或枚举其标签，不能从businessServiceRatio值反推具体比例。',
    ],
  },
  'sale-visit-recommend-setting-prepare-save': {
    purpose: '按推荐设置页面的全部表单校验，把用户表单转换为可确认提交的推荐设置POST请求体，不发网络请求。',
    whenToUse: '用户准备保存推荐设置时使用；先用get取得当前值，再把recommendRatio和keyAgeSettings转换成页面表单并调用本能力。',
    boundaries: commonBoundaries,
    effect: 'prepare',
    prerequisites: ['已读取或由用户明确提供完整表单；表单必须保留至少一条关键日龄设置。'],
    inputs: formInputs,
    output: { shape: 'object', fields: draftFields, empty: '始终返回包含setting和keyAgeSettings的完整draft；非法表单不会返回部分草稿。' },
    consume: [
      '把result.draft原样交给sale-visit-recommend-setting-save；不要把result.draft.setting.id或关键日龄id当成用户要填写的业务ID。',
      'businessServiceRatio未选择时使用空字符串；keyDayItems[].pushPoint提交前去除首尾空白；keyDayItems行不带页面内部_rowKey。',
    ],
    steps: [
      { role: 'required', when: '用户确认准备结果并要写入服务端', capabilityId: 'sale-visit-recommend-setting-save', mapping: { draft: 'result.draft' }, instruction: '提交同一份draft；save回执成功或结果不确定后都必须调用get回查。' },
      { role: 'cancel', when: '用户取消保存或只想放弃本地修改', instruction: '丢弃result.draft，不调用save；Portal没有服务端cancel接口，本地删除关键日龄也不会单独写入。' },
    ],
    completion: '得到完整、未写入服务端的POST草稿；这一步不代表推荐设置已保存。',
    failures: commonFailures,
    idempotency: null,
    evidence,
    gaps: [
      '真实测试环境smoke未执行；本能力只做离线表单校验和载荷构造，未验证部署环境的实际校验消息。',
      'businessServiceRatio的运行时字典选项未被本能力枚举；只验证页面允许的字符串/空值形状。',
    ],
  },
  'sale-visit-recommend-setting-save': {
    purpose: '提交推荐设置主配置和完整关键日龄数组，覆盖当前租户的推荐设置。',
    whenToUse: '用户确认sale-visit-recommend-setting-prepare-save的draft后使用；不能跳过准备步骤自行猜测字段或ID。',
    boundaries: commonBoundaries,
    effect: 'write',
    prerequisites: ['具备页面写权限；draft必须来自最新get后的表单准备结果或等价的完整页面草稿。'],
    inputs: draftInputs,
    output: boolOutput,
    consume: [
      'POST请求只发送setting和keyAgeSettings两层对象；主配置字段使用后端名称recommendRatio，关键日龄字段使用keyAge。',
      '后端按当前租户查找主配置：不存在则新增，存在则更新；非空keyAgeSettings会先删除当前租户旧关键日龄再批量插入新数组，因此提交数组代表完整替换集合。',
      'true只表示保存请求回执；收到回执或请求超时后都要调用get，逐字段核对四个主配置值、关键日龄值和推送要点。',
    ],
    steps: [
      { role: 'required', when: 'POST返回true或请求结果不确定', capabilityId: 'sale-visit-recommend-setting-get', mapping: {}, instruction: '重新读取当前租户；将get结果转换为表单语义后逐项比较目标值。任一字段不符、读取失败或超时未确认时都只能报告未核实。' },
      { role: 'cancel', when: '用户要求恢复保存前的配置且调用方持有保存前get快照', instruction: 'Portal和Java没有cancel/恢复接口；只能把保存前快照重新转换为完整表单，再走prepareSave和save覆盖写回。这不是事务回滚，且仍需get回查。' },
    ],
    completion: '只有POST返回true且后续get逐字段确认目标值一致，才能报告当前租户推荐设置已保存；不能据此报告推荐任务已经生成或客户已被推荐。',
    failures: commonFailures,
    idempotency: '后端没有requestId幂等键，也没有撤销接口；保存会整批替换关键日龄设置。成功或超时都先get核实，未核实前不要重复提交，以免覆盖并发修改。',
    evidence,
    gaps: [
      '真实测试环境smoke未执行；未做真实get→prepareSave→save→get写入回查，也未记录可清理的线上数据。',
      '页面没有后端cancel/恢复动作，本契约只能说明用保存前快照再次覆盖的补偿方式，未在线验证其事务和并发行为。',
      'Java服务实现对关键日龄设置是先删后插的整批替换；本轮未在部署环境验证部分失败时的最终数据状态。',
    ],
  },
}

export const SALE_VISIT_RECOMMEND_SETTING_AI_CONTRACTS = contracts

export const SALE_VISIT_RECOMMEND_SETTING_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SALE_VISIT_RECOMMEND_SETTING_METHODS).map(([capabilityId, method]) => {
    const source = SALE_VISIT_RECOMMEND_SETTING_AI_CONTRACTS[capabilityId]!
    return [`saleVisitRecommendSetting.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法签名saleVisitRecommendSetting.${method}(args)，能力invoke使用同名输入对象；get无参数，prepareSave接收form，save接收draft。`,
      ],
    }]
  }),
)
