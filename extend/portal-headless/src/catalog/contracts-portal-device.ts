import type { AiContract, AiField } from './ai-contract.js'

const deviceFields: AiField[] = [
  { path: '$', type: 'object', meaning: '登录设备的页面可见字段及当前设备标记；不透传后端扩展字段。' },
  { path: 'deviceCode', type: 'string', meaning: '登录设备唯一标识，移除时填 targetDeviceCode；不是人员 ID 或设备名称。', source: '当前用户登录设备列表' },
  { path: 'deviceName', type: 'string', optional: true, nullable: true, nullMeaning: '页面显示未知设备。', meaning: '设备名称；空字符串同样显示未知设备。' },
  { path: 'loginApp', type: 'number', optional: true, nullable: true, nullMeaning: '页面按非 PC 分组，不能据此推断真实终端型号。', meaning: '终端标志；严格等于数字 2 属于 PC，其他值按页面归入 APP。', values: { '1': '手机 APP', '2': 'PC' }, constraints: ['保留未知数值；页面非 2 分支不证明后端只可能返回 1。'] },
  { path: 'loginAppName', type: 'string', optional: true, nullable: true, nullMeaning: '页面显示破折号。', meaning: '登录终端展示名；空字符串也显示破折号。' },
  { path: 'loginTypeName', type: 'string', optional: true, nullable: true, nullMeaning: '页面显示破折号。', meaning: '登录方式展示名；不据此猜测登录方式编码。' },
  { path: 'activeArea', type: 'string', optional: true, nullable: true, nullMeaning: '不显示活动地区。', meaning: '最近活动地区文字；空字符串同样不显示。' },
  { path: 'activeTime', type: 'string | number', optional: true, nullable: true, nullMeaning: '页面显示破折号。', meaning: '最近活动时间原值；页面将数字或可转数字字符串按毫秒时间戳展示，非数字字符串原样显示。', unit: '数值按毫秒时间戳；非数字字符串不换算', constraints: ['0、空字符串与缺席显示破折号。', '按展示端本地时区渲染，SDK 不将原值强制改成日期字符串。'] },
  { path: 'isCurrent', type: 'boolean', nullable: true, nullMeaning: 'SDK 未配置当前设备标识；不是 false，不能安全执行移除。', meaning: 'deviceCode 与构造本 SDK 实例时提供的 currentDeviceCode 是否相等。true 表示本机，禁止移除。' },
]
const targetInput = {
  targetDeviceCode: {
    meaning: '用户选择移除的登录设备标识；不得为当前设备标识。',
    source: 'portal-device-list 返回选中设备的 [].deviceCode；不是名称或人员 ID。',
    type: 'string', required: true,
    constraints: ['必须非空，保持原值，不生成设备标识。', '当前 SDK 实例必须已配置调用方真实 currentDeviceCode，且目标仍在该用户实时列表。'],
  },
}
function contract(purpose: string, effect: AiContract['effect'], output: AiContract['output']): AiContract {
  return {
    purpose, whenToUse: purpose, effect,
    boundaries: ['外壳头像菜单中的设备管理，包含 PC 与 APP 登录设备。', '不管理平台设备账号配置；不新增设备，不提供移除后的恢复或撤销。', '数据按当前会话 token 的登录账号范围获取；zhdj-app 页面请求不发送 tenant-id 或 module-type，不能承诺租户级设备隔离。'],
    prerequisites: ['调用方必须显式配置 httpBaseUrls["zhdj-app"]，不能使用默认主后端地址凑请求。', '使用绑定当前用户会话的 SDK，请求 token 由集中客户端注入；不能使用私人令牌代替。'],
    inputs: {}, output,
    consume: ['展示当前账号设备信息；deviceCode 仅用于准确选中设备，不能把名称当标识。'],
    steps: [], completion: '交付本次读取结果；不据此声称已移除设备。',
    failures: ['未配置 zhdj-app 地址时调用在请求前拒绝，补齐真实地址后可重试读取。', '鉴权、网络或包络错误会抛出；不能当作设备为空。', '设备列表格式错误会抛出，不归一为空数组，因此不能伪证移除成功。'],
    idempotency: null,
    evidence: [
      { source: 'app/portal/utils/common/login-device/service.js 与 LoginDeviceList.vue（前端 d3cf56bdc7）', kind: 'reference', note: '静态核对列表/数量/移除接口、字段、当前设备保护和展示转换；未观察线上响应。' },
      { source: 'src/capabilities/portal-device.ts', kind: 'implementation', note: 'SDK 白名单、实例选择、身份上下文、本机保护及独立列表复查。' },
      { source: 'test/portal-device.test.ts', kind: 'test', note: '离线独立夹具，不是线上设备下线记录。' },
    ],
    gaps: ['固定 test/test Java 仓库未包含外部 zhdj-app 的 /device/*.json 实现；实际响应字段类型、权限与副作用尚缺独立后端证据。', '未做真实环境读冒烟或移除设备操作；不能将离线测试当作 prepare → submit → cancel 的线上证据。页面无撤销入口。'],
  }
}
const list = contract('列出当前账号登录设备，识别本机并展示 PC/APP 分组所需字段。', 'read', {
  shape: 'PortalLoginDevice[]，裸数组，无分页包络',
  fields: [{ path: '$', type: 'array', meaning: '当前账号登录设备列表；本机（如果已知）优先，其余保持接口顺序。' }, ...deviceFields.map(field => ({ ...field, path: field.path === '$' ? '[]' : `[].${field.path}` }))],
  empty: '[] 表示接口返回空设备列表；isCurrent=null 表示未配置本机标识，不是列表为空。',
})
list.consume.push('按 loginApp===2 分 PC，其余按页面分 APP；本机不可移除。数字 activeTime 按展示端本地时区显示，非数字字符串原样显示。')
list.steps = [{ role: 'optional', when: '用户要移除选中设备且 isCurrent=false', capabilityId: 'portal-device-prepare-remove', mapping: { targetDeviceCode: 'result.[].deviceCode' }, instruction: '只选择用户指定的一台设备；isCurrent=true 或 null 时停止移除。' }]
const count = contract('查询当前账号 PC 常用设备数量及数量上限。', 'read', {
  shape: '{currentCount:number,maxCount:number}',
  fields: [
    { path: '$', type: 'object', meaning: 'PC 登录设备计数；不含 APP 设备数量。' },
    { path: 'currentCount', type: 'number', unit: '台', meaning: 'count 按前端 count || 0 回退后返回；缺席或 0 均为 0。' },
    { path: 'maxCount', type: 'number', unit: '台', meaning: 'maxCount 按前端 maxCount || 5 回退；缺席或 0 均显示为 5，不证明服务端配置真的为 5。' },
  ], empty: '对象字段采用页面回退；整个响应缺失或类型错误抛出，不假装为 0 台。',
})
count.consume = ['展示 PC 端 currentCount/maxCount；不要拿 APP 列表长度替代 PC 数量，也不据默认 5 推定真实限额。']
const prepare = contract('只读检查目标登录设备仍存在且不是本机，返回准备移除的设备。', 'prepare', {
  shape: 'PortalLoginDevice', fields: deviceFields, empty: '不存在、本机或缺当前设备上下文时抛错，不返回可移除对象。',
})
prepare.inputs = targetInput
prepare.prerequisites.push('由调用方在本用户 SDK 实例中配置真实 currentDeviceCode；来自已知设备上下文，不允许伪造。')
prepare.consume = ['展示目标设备的名称、最近活动信息；prepare 不会使设备下线。']
prepare.steps = [{ role: 'optional', when: '用户要求执行该设备的移除', capabilityId: 'portal-device-remove', mapping: { targetDeviceCode: 'result.deviceCode' }, instruction: '传这台设备的 deviceCode；remove 会再次读取列表检查，准备结果不是服务端锁。' }]
prepare.completion = '已交付待移除设备信息，尚未发送 kick 请求。'
const remove = contract('移除当前账号的一台非本机登录设备，并用独立列表查询核实它已消失。', 'write', {
  shape: '{targetDeviceCode:string,removed:boolean}',
  fields: [
    { path: '$', type: 'object', meaning: '移除请求后独立设备列表复查的回执。' },
    { path: 'targetDeviceCode', type: 'string', meaning: '实际提交移除的设备标识，与输入同一设备。' },
    { path: 'removed', type: 'boolean', meaning: 'true=请求后列表已无此设备；false=仍在列表，不能报告移除完成。' },
  ], empty: '成功读取复查列表才返回回执；无数据或复查错误抛出“结果不确定”，不是 removed=true。',
})
remove.inputs = targetInput
remove.prerequisites.push('由调用方给本实例配置真实 currentDeviceCode；移除目标必须非本机且在本次请求前设备列表中。')
remove.consume = ['只有 removed=true 才报告该设备从当前账号登录设备列表移除；removed=false 应说明尚未确认完成并刷新列表。']
remove.steps = [{ role: 'recovery', when: 'removed=false 或移除请求/复查超时结果不确定', capabilityId: 'portal-device-list', mapping: {}, instruction: '先重新查询目标 deviceCode 是否仍在；不能仅因 HTTP GET 就自动重试 kick。' }]
remove.idempotency = '没有 requestId 或服务端幂等保证；GET /device/kick.json 是写操作。SDK 每次执行前查询存在性并禁止本机，但没有跨进程防重。结果不确定先查列表，不直接重发。'
remove.completion = 'removed=true 表示本次独立列表中已无该设备；不承诺历史 token 全部即时失效。没有页面恢复入口，不能调用设备注册冒充撤销。'
remove.failures.push('本机/缺当前设备/列表无目标会在 kick 之前拒绝；修正真实上下文或重新选设备。', 'kick 网络错误或返回后复查失败可能已经产生移除，先重查设备列表；不得因异常自动重复写入。')
export const PORTAL_DEVICE_CONTRACTS: Record<string, AiContract> = {
  'portal-device-list': list,
  'portal-device-count': count,
  'portal-device-prepare-remove': prepare,
  'portal-device-remove': remove,
}
