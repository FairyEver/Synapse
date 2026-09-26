/** SDK-readable content schema, sourced from the fixed Portal editor and Java validator. */
export type ContractContentField = {
  path: string
  type: string
  meaning: string
  required: boolean
  values?: Record<string, string>
  constraints?: string[]
}
const field = (path: string, type: string, meaning: string, constraints?: string[], required = true): ContractContentField => ({ path, type, meaning, required, ...(constraints ? { constraints } : {}) })
const enumField = (path: string, meaning: string, values: Record<string, string>): ContractContentField => ({ ...field(path, 'string', meaning), values })
const inputModes = { offline: '线下填写：打印留白，不用 content 填充正文', online: '线上填写：解析 content 中的变量并展示' }
const singleLine = ['必须是字符串；允许空串；不允许换行；长度按 Unicode 字符数，去首尾空白后计数']
const expression = (path: string, meaning: string, limit: number) => field(path, 'string', meaning, [...singleLine, `变量解析后的最终文本最多 ${limit} 字；模板保存时先校验静态部分，实际合同保存再校验替换结果`])
const editableFields = (prefix: string, finalLimit: number): ContractContentField[] => [
  field(`${prefix}.id`, 'string', '字段本地标识；调用方生成，同一 fields 数组内唯一，编辑时保留', ['非空字符串']),
  field(`${prefix}.visible`, 'boolean', '是否展示字段；隐藏仍需完整字段结构'),
  field(`${prefix}.label`, 'string', '固定标签，不解析变量', [...singleLine, '最多 20 字']),
  enumField(`${prefix}.inputMode`, '填写方式', inputModes),
  field(`${prefix}.content`, 'string', '字段内容；online 解析变量，offline 为普通文本配置', [...singleLine, '原表达式最多 500 字', `visible=true 且 inputMode=online 时，最终文本最多 ${finalLimit} 字`]),
]
const emptyData = [field('$', 'object', '此组件没有内部配置字段，data 填 {}；不是未定义结构')]
const align = enumField('align', '文字对齐', { left: '左对齐', center: '居中', right: '右对齐' })
const tableFields = [field('center', 'boolean', '表格整体是否居中'), field('table', 'object', '网格表格配置，字段见 tableSchema')]
const newField = (id: string, label: string) => ({ id, visible: true, label, inputMode: 'offline', content: '' })
const fullLabels = ['组织机构代码', '地址', '邮政编码', '法定代表人', '委托代理人', '电话', '传真', '电子信箱', '开户银行', '账号']

const MATERIAL_TABLE_DEFAULT = {
  "center": true,
  "table": {
    "columns": [
      {
        "size": 57,
        "name": "",
        "hidden": false
      },
      {
        "size": 60,
        "name": "",
        "hidden": false
      },
      {
        "size": 97,
        "name": "",
        "hidden": false
      },
      {
        "size": 55,
        "name": "",
        "hidden": false
      },
      {
        "size": 62,
        "name": "",
        "hidden": false
      },
      {
        "size": 63,
        "name": "",
        "hidden": false
      },
      {
        "size": 46,
        "name": "",
        "hidden": false
      },
      {
        "size": 70,
        "name": "",
        "hidden": false
      },
      {
        "size": 69,
        "name": "",
        "hidden": false
      },
      {
        "size": 51,
        "name": "",
        "hidden": false
      }
    ],
    "rows": [
      {
        "size": 30,
        "name": "",
        "hidden": false
      },
      {
        "size": 30,
        "name": "",
        "hidden": false
      },
      {
        "size": 30,
        "name": "",
        "hidden": false
      }
    ],
    "cells": [
      {
        "id": "7yJHfQA7",
        "name": "",
        "className": "gt-flex-y-center gt-text-center",
        "x": 0,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "名称"
      },
      {
        "id": "CCePsTEp",
        "name": "name",
        "className": "gt-text-center gt-flex-y-center",
        "x": 0,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "NWcLUqDL",
        "name": "",
        "className": "gt-flex-y-center gt-text-center",
        "x": 1,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "型号"
      },
      {
        "id": "tnQy3ZAS",
        "name": "model",
        "className": "gt-text-center gt-flex-y-center",
        "x": 1,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "24GPeBs0",
        "name": "",
        "className": "gt-flex-y-center gt-text-center",
        "x": 3,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "数量"
      },
      {
        "id": "M_yhw2O-",
        "name": "quantity",
        "className": "gt-text-center gt-flex-y-center",
        "x": 3,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "YsBtixYe",
        "name": "",
        "className": "gt-flex-y-center gt-text-center",
        "x": 6,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "单位"
      },
      {
        "id": "JAQDH2-U",
        "name": "",
        "className": "gt-flex-y-center gt-text-center",
        "x": 7,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "单价(元)"
      },
      {
        "id": "m3WsraJL",
        "name": "",
        "className": "gt-flex-y-center gt-text-center",
        "x": 8,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "金额(元)"
      },
      {
        "id": "yaautVRy",
        "name": "",
        "className": "gt-text-center gt-flex-y-center",
        "x": 9,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "备注"
      },
      {
        "id": "n-qGnqSa",
        "name": "unit",
        "className": "gt-text-center gt-flex-y-center",
        "x": 6,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "tzClyoMx",
        "name": "price",
        "className": "gt-text-center gt-flex-y-center",
        "x": 7,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "Jb-O8pur",
        "name": "amount",
        "className": "gt-text-center gt-flex-y-center",
        "x": 8,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "NTk0BcWV",
        "name": "note",
        "className": "gt-text-center gt-flex-y-center",
        "x": 9,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "FeT3KcP9",
        "name": "",
        "className": "gt-text-center gt-flex-y-center",
        "x": 2,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "品牌及厂家"
      },
      {
        "id": "OcnqQA63",
        "name": "brand",
        "className": "gt-text-center gt-flex-y-center",
        "x": 2,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "0U8pGb7j",
        "name": "",
        "className": "gt-flex-y-center",
        "x": 0,
        "y": 2,
        "w": 10,
        "h": 1,
        "html": "    合计含税金额（人民币大写）：<%= 供:采购商品总价_大写 %>"
      },
      {
        "id": "YIsR73c0",
        "name": "",
        "className": "gt-text-center gt-flex-y-center",
        "x": 4,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "赠送比例"
      },
      {
        "id": "etiIDRCo",
        "name": "giftRatio",
        "className": "gt-text-center gt-flex-y-center",
        "x": 4,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      },
      {
        "id": "gkkGS3TE",
        "name": "",
        "className": "gt-text-center gt-flex-y-center",
        "x": 5,
        "y": 0,
        "w": 1,
        "h": 1,
        "html": "赠送数量"
      },
      {
        "id": "q6dE7OJ5",
        "name": "giftCount",
        "className": "gt-text-center gt-flex-y-center",
        "x": 5,
        "y": 1,
        "w": 1,
        "h": 1,
        "html": ""
      }
    ]
  }
}
const PREDEFINED_VARIABLES = [
  {
    "label": "时间",
    "contractKey": "time",
    "valueType": "string",
    "defaultValue": "____年____月____日"
  },
  {
    "label": "自定义变量",
    "contractKey": "createText",
    "valueType": "string",
    "defaultValue": "自定义变量的内容"
  },
  {
    "label": "甲方名称",
    "contractKey": "commonPartyNameA",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "乙方名称",
    "contractKey": "commonPartyNameB",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "合同编号",
    "contractKey": "commonContractNumber",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "签订地点",
    "contractKey": "commonSigningPlace",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "甲方法定代表人或授权代表",
    "contractKey": "commonPartyRepresentativeA",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "乙方法定代表人或授权代表",
    "contractKey": "commonPartyRepresentativeB",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "甲方住所地",
    "contractKey": "commonPartyAddressA",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "乙方住所地",
    "contractKey": "commonPartyAddressB",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "甲方签署日期",
    "contractKey": "commonSigningDateA",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "乙方签署日期",
    "contractKey": "commonSigningDateB",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "合同一式N份",
    "contractKey": "commonCopyNumber",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "甲方乙方各持N份",
    "contractKey": "commonPartyHoldNumber",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品名称",
    "contractKey": "supplyPurchaseGoodsName",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品单位",
    "contractKey": "supplyPurchaseGoodsUnit",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品单价",
    "contractKey": "supplyPurchaseGoodsPrice",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品数量",
    "contractKey": "supplyPurchaseGoodsQuantity",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品总价",
    "contractKey": "supplyPurchaseGoodsPriceTotal",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品总价_大写",
    "contractKey": "supplyPurchaseGoodsPriceTotalWord",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品备注",
    "contractKey": "supplyPurchaseGoodsRemark",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品质量标准",
    "contractKey": "supplyPurchaseGoodsQualityStandard",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品交货时间",
    "contractKey": "supplyPurchaseGoodsDeliveryTime",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品付款方式",
    "contractKey": "supplyPurchaseGoodsPaymentMethod",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品规格型号",
    "contractKey": "supplyPurchaseGoodsSpecification",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品赠送比例",
    "contractKey": "supplyPurchaseGoodsGiftRatio",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品品牌",
    "contractKey": "supplyPurchaseGoodsBrand",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品供应商",
    "contractKey": "supplyPurchaseGoodsSupplier",
    "valueType": "string",
    "defaultValue": ""
  },
  {
    "label": "供:采购商品列表",
    "contractKey": "supplyPurchaseGoodsList",
    "valueType": "JSON 数组字符串",
    "defaultValue": "[]"
  }
]

export const CONTRACT_TEMPLATE_CONTENT_SCHEMA = {
  id: 'contract-template-content',
  version: '1.1.0',
  purpose: '合同模板 content JSON 字符串的内部结构与编辑约束；用于 contract-template-create/update 的仅保存，不发起审批或签署。',
  rootFields: [
    field('version', 'string', '内容结构版本，区别于列表返回的模板修订 version 数字', ['非空；包含 Cover/AutoDirectory/SigningInfo 时必须为 1.1.0；旧版可用 1.0.0']),
    field('blocks', 'object[]', '按渲染顺序排列的内容组件；允许 [] 表示空模板'),
    field('blocks[].id', 'string', '调用方生成的组件本地 ID；非业务实体 ID，编辑时保留', ['非空；本模板所有 blocks 内唯一']),
    field('blocks[].name', 'string', '组件名；从 blocks 说明选择，大小写与斜杠必须一致', ['非空；不要自造组件名：后端允许历史自定义块，不表示当前前端能渲染']),
    field('blocks[].data', 'object', '与 name 对应的配置对象；具体字段见对应 blocks[].dataFields'),
  ],
  constraints: [
    '调用时 content 必须 JSON.stringify 整个配置对象得到一个 JSON 字符串；不能直接传对象、null、数组或两个相接 JSON 文本。',
    '只有 Cover 与 AutoDirectory 是单例：封面必须位于 blocks[0]；有封面时目录位于 blocks[1]，无封面时目录位于 blocks[0]。其他组件排在这两个结构块之后。',
    '这里的 defaultData 中 ID 是可读示例。每插入一个组件/字段/签署方都生成相应范围唯一的非空字符串 ID，不要复制同一示例 ID 多次。',
    'SDK 当前仅做 content 根对象/version/blocks 的基础校验；本 schema 说明前后端的实际约束，不声称 SDK 已执行所有深层规则。',
    'Java 对旧版和业务自定义 block 只校验 id/name/data，不校验内部结构。此兼容行为不是新增未知组件的授权；已有未知块应保留原样，并说明当前客户端无法解释/渲染。',
    '仅保存会写入模板与版本；新增 schema 不增加流程提交、合同数据填报或在线签署能力。',
  ],
  blocks: [
    { name: 'Contract/Cover', title: '合同封面', dataFields: [
      enumField('layout', '封面版式', { minimal: '极简型，fields 0 项', parties: '双方信息型，fields 最多 5 项', engineering: '工程信息型，fields 最多 8 项' }),
      field('code', 'object', '合同编号配置；和信息字段相同但没有 id'),
      ...editableFields('code', 100).filter(f => f.path !== 'code.id'),
      expression('title', '封面主标题', 60), expression('subtitle', '封面副标题；隐藏时仍必须为合法字符串', 40),
      field('subtitleVisible', 'boolean', '是否显示副标题；省略时前端显示，前端校验类型，Java 当前未校验此字段', undefined, false),
      field('fields', 'object[]', '附加信息；数量由 layout 限定'), ...editableFields('fields[]', 200),
      field('footer', 'string', '底部署名；支持变量和换行', ['允许空串；非空内容最多 5 行；最终文本最多 200 字；模板先校验静态文本，合同保存校验实际替换结果']),
    ], defaultData: { layout: 'engineering', code: { visible: true, label: '合同编号', inputMode: 'online', content: '<%= 合同编号 %>' }, title: '合同', subtitle: '', subtitleVisible: true, fields: ['工程名称', '工程地点', '发包人', '承包人'].map((label, index) => newField(`cover-field-${index + 1}`, label)), footer: '' }, constraints: ['version=1.1.0；最多一个且在首位；隐藏副标题不免除 Java 对 subtitle 的格式和长度校验'] },
    { name: 'Contract/AutoDirectory', title: '自动目录', dataFields: [field('title', 'string', '目录标题；不解析变量', [...singleLine, '最多 20 字']), field('maxLevel', 'integer', '收录 Common/Heading 的最大层级', ['1..4']), field('showPageNumber', 'boolean', '是否展示打印分页计算出的页码')], defaultData: { title: '目录', maxLevel: 4, showPageNumber: true }, constraints: ['version=1.1.0；最多一个；有封面紧随封面，否则位于首位；目录内容来自段落标题，不手填条目'] },
    { name: 'Contract/SigningInfo', title: '签署信息', dataFields: [
      enumField('preset', '签署信息预设', { compact: '精简型', full: '完整型' }), field('parties', 'object[]', '签署双方', ['恰好两方']),
      field('parties[].id', 'string', '签署方本地 ID', ['非空；两方之间唯一']), field('parties[].name', 'string', '签署方称谓，例如发包人；不等同主体名称', [...singleLine, '最多 20 字']),
      field('parties[].sealLabel', 'string', '印章标注；和 subjectInputMode/subjectContent 同组可选。任一存在时三者都必须有；这是当前 Web 约束，Java 未校验', [...singleLine, '最多 20 字'], false),
      { ...enumField('parties[].subjectInputMode', '主体名称录入方式；同组可选规则见 sealLabel', inputModes), required: false },
      field('parties[].subjectContent', 'string', '主体名称内容，online 解析变量；同组可选规则见 sealLabel', [...singleLine, '表达式最多 500 字；online 最终文本最多 300 字；当前由 Web 校验，Java 未校验'], false),
      field('parties[].fields', 'object[]', '该方附加信息字段', ['每方最多 12 项；含隐藏字段']), ...editableFields('parties[].fields[]', 300),
    ], defaultData: { preset: 'full', parties: ['发包人', '承包人'].map((name, p) => ({ id: `party-${p + 1}`, name, sealLabel: '公章', subjectInputMode: 'online', subjectContent: p === 0 ? '<%= 甲方名称 %>' : '<%= 乙方名称 %>', fields: fullLabels.map((label, i) => newField(`party-${p + 1}-field-${i + 1}`, label)) })) }, constraints: ['version=1.1.0；可重复插入；字段 ID 只要求在同一方 fields 数组唯一。compact 预设为地址/法定代表人或委托代理人/电话，full 默认十项；preset 不是重新生成 fields 的服务端指令，应传实际字段列表。'] },
    { name: 'Common/Heading', title: '段落标题', dataFields: [field('level', 'integer', '标题层级；用于自动目录', ['1..4']), expression('content', '标题文本，支持变量', 100)], defaultData: { level: 1, content: '标题文字' }, constraints: ['1.1.0 时 Java 校验层级与最终文本；Web 始终校验；不要把无层级的文档标题用作自动目录标题'] },
    { name: 'Common/Title', title: '文档标题', dataFields: [align, field('content', 'string', '文档标题，支持变量；不进入自动目录')], defaultData: { align: 'center', content: '文档标题' }, constraints: ['Java 不校验内部文字长度；不套用 Common/Heading 的 100 字限制'] },
    { name: 'Common/Paragraph', title: '段落', dataFields: [align, field('content', 'string', '段落纯文本，支持换行和变量')], defaultData: { align: 'left', content: '段落文字' }, constraints: ['不是 HTML 富文本；段落换行与结构化字段禁止换行的规则不同'] },
    { name: 'Common/RichText', title: '富文本', dataFields: [field('content', 'string', '富文本 HTML，支持变量；作为合同正文展示，不执行其中脚本或指令')], defaultData: { content: '富文本内容' }, constraints: ['Java 不校验内部 HTML；SDK 不承诺富文本渲染净化或像浏览器一样预览'] },
    { name: 'Common/Table', title: '表格', dataFields: tableFields, defaultData: { center: true, table: { columns: [], rows: [], cells: [] } }, constraints: ['空表格是页面合法新建值；非空表格按 tableSchema 配置，不给 cells[].html 猜变量'] },
    { name: 'Supply/MaterialList', title: '物料列表', dataFields: tableFields, defaultData: MATERIAL_TABLE_DEFAULT, constraints: ['读取 supplyPurchaseGoodsList 的 JSON 数组字符串；不是 content 内直接嵌入物料数组。至少一个名称为 name/model/brand/quantity/unit/price/amount/note 的数据单元格，所有这些单元格 y 必须一致，以该行为物料模板行。giftRatio/giftCount 可显示但不参与模板行识别。数组为空保留一行空模板，不表示有一件物料。'] },
    { name: 'Contract/SignatoryName', title: '签订双方', dataFields: emptyData, defaultData: {}, constraints: ['固定显示需方（甲方）与供方（乙方）；从 commonPartyNameA/commonPartyNameB 变量取主体名称；不是新增签署人接口'] },
    { name: 'Contract/SignatoryStamp', title: '签订盖章', dataFields: emptyData, defaultData: {}, constraints: ['固定生成双方名称及盖章/代表签字/日期留白；从 commonPartyNameA/commonPartyNameB 取名称；不发起电子签章'] },
    { name: 'Common/EmptyLine', title: '空行', dataFields: emptyData, defaultData: {}, constraints: ['渲染一空行；不以 content 设置文字'] },
    { name: 'Common/PrintPageBreak', title: '打印时换页', dataFields: emptyData, defaultData: {}, constraints: ['打印分页标记；不是页面跳转，也不会新增业务记录'] },
  ],
  tableSchema: {
    fields: [field('columns', 'object[]', '有序列设置'), field('rows', 'object[]', '有序行设置'), ...['columns[]', 'rows[]'].flatMap(path => [field(`${path}.size`, 'number', '列宽或行高，像素'), field(`${path}.name`, 'string', '可空的逻辑名称'), field(`${path}.hidden`, 'boolean', '是否隐藏该列/行')]), field('cells', 'object[]', '单元格；合并区域由一个单元格表示'), field('cells[].id', 'string', '唯一的单元格本地 ID'), field('cells[].name', 'string', '逻辑名称；物料表用来映射物料字段'), field('cells[].className', 'string', '表格预设样式类；可用值见 classes'), field('cells[].x', 'integer', '起始列索引，0 起'), field('cells[].y', 'integer', '起始行索引，0 起'), field('cells[].w', 'integer', '横向跨列数，默认 1'), field('cells[].h', 'integer', '纵向跨行数，默认 1'), field('cells[].html', 'string', 'HTML 单元格内容，支持变量；物料数据行根据 name 动态填充')],
    constraints: ['生成器默认列宽 60px、行高 30px；x/y 应非负且位于 rows/columns 中，w/h 应为正整数并不越界；这些是前端网格可渲染要求，Java 未验证。', '旧数据 rows/columns 中的数字会由前端迁移为 size/name/hidden 对象；新写使用完整对象。不要重置已有合并区域。'],
    classes: ['gt-flex-center-all', 'gt-bg-gray-100', 'gt-font-bold', 'gt-px-1', 'gt-py-1', 'gt-text-left', 'gt-text-center', 'gt-text-right', 'gt-flex-y-top', 'gt-flex-y-center', 'gt-flex-y-bottom'],
  },
  variableSyntax: {
    raw: '<%= 甲方名称 %>', escaped: '&lt;%= 甲方名称 %&gt;',
    constraints: ['这里只是变量引用，不是可执行 EJS/JavaScript。占位符内部名称去首尾空白后必须为 1..30 字，仅中文、英文字母、数字、下划线、半角或全角冒号；不允许未闭合、空名或混合半个标记。', '预定义变量用显示 label 引用，通过 variables 映射到 contractKey；自定义变量的 contractKey 就是其变量名。', '模板 content 只保存引用；实际合同 dataList 的 contractKey 必须非空且去首尾空白后唯一，contractValue 为字符串（null 在后端按空串）。当前模板 SDK 不接入实际合同 dataList 写入。', '实际合同 1.1.0 后端替换缺失变量为空串，再校验文本长度/换行；旧前端预览可能使用默认值或变量名，不应把预览占位文字当成最终合同。'],
  },
  variables: PREDEFINED_VARIABLES,
  materialListFields: [field('name', 'string', '名称'), field('model', 'string', '型号'), field('brand', 'string', '品牌及厂家'), field('quantity', 'number', '数量，计量单位取 unit'), field('giftRatio', 'string', '赠送比例显示文本，保留原格式'), field('giftCount', 'string', '赠送数量显示文本'), field('unit', 'string', '物料计量单位'), field('price', 'number', '单价，元'), field('amount', 'number', '金额，元；展示输入值，不自动重算 quantity×price'), field('note', 'string', '备注')],
  historicalBlocks: [{ name: 'Supply/Table', behavior: '前端 disabled=true，不在新建选择列表；历史物料表仍可读取，保留其 data，新增请使用 Supply/MaterialList。' }],
  evidence: [
    { repository: 'Web', revision: 'd3cf56bdc76c73c5eb9252be84b9b39b3900b48e', paths: ['app/portal/library/contract/utils/blocks.js', 'app/portal/library/contract/utils/structure.js', 'app/portal/library/contract/utils/validation.js', 'app/portal/library/contract/utils/variable.js', 'app/portal/library/contract/blocks/**/{main.js,define.js,read.vue}', 'common/components/common/grid-table/tools.js'], finding: '13 个当前可添加组件、一个禁用历史组件；字段默认值、变量/表格/渲染语义及 Web 独有约束。' },
    { repository: 'Java', revision: 'dcb3f360194e63c33cfd7ef9df4360355ff13533', paths: ['erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/contract/ContractContentValidator.java'], finding: '根结构、单例顺序、1.1.0 结构块校验、变量解析和合同最终值约束。未执行 Java 测试或真实保存；本轮为源码推导与 SDK 描述离线验证。' },
  ],
}
