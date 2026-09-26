import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../capabilities/index.js'

/** Fields verified against backend dcb3f360194 DTO/RespVO/DO; browser baseline verifies requests only. */
const schemas: Record<string, AiField[]> = {
  "AiModelConfigDTO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelName",
      "type": "string",
      "meaning": "模型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "description",
      "type": "string",
      "meaning": "模型描述",
      "optional": true,
      "nullable": true
    },
    {
      "path": "apiUrl",
      "type": "string",
      "meaning": "模型API地址",
      "optional": true,
      "nullable": true
    },
    {
      "path": "apiKey",
      "type": "string",
      "meaning": "模型API密钥；当前列表/详情后端可能保留原值，可用候选置null；不输出给用户",
      "optional": true,
      "nullable": true
    },
    {
      "path": "authToken",
      "type": "string",
      "meaning": "认证字段，不输出到用户",
      "optional": true,
      "nullable": true
    },
    {
      "path": "availableStatus",
      "type": "number",
      "meaning": "可用状态：0未测试、1正常、2异常",
      "optional": true,
      "nullable": true
    },
    {
      "path": "availableStatusName",
      "type": "string",
      "meaning": "可用状态显示名",
      "optional": true,
      "nullable": true
    },
    {
      "path": "supportedFiles",
      "type": "string",
      "meaning": "支持文件类型串，保持原值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "supportImgNum",
      "type": "number",
      "meaning": "支持图片数量",
      "optional": true,
      "nullable": true
    },
    {
      "path": "lastTestTime",
      "type": "string",
      "meaning": "最近测试时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "lastTestMessage",
      "type": "string",
      "meaning": "最近测试结果说明",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createId",
      "type": "number | string",
      "meaning": "创建人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateId",
      "type": "number | string",
      "meaning": "修改人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "修改时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "remark",
      "type": "string",
      "meaning": "备注",
      "optional": true,
      "nullable": true
    },
    {
      "path": "delFlag",
      "type": "number",
      "meaning": "删除标记",
      "optional": true,
      "nullable": true
    },
    {
      "path": "apiKeyMasked",
      "type": "string",
      "meaning": "掩码密钥，不是可用API密钥",
      "optional": true,
      "nullable": true
    },
    {
      "path": "embeddingModel",
      "type": "string",
      "meaning": "嵌入模型配置",
      "optional": true,
      "nullable": true
    },
    {
      "path": "enableThinking",
      "type": "boolean",
      "meaning": "是否启用思考模式",
      "optional": true,
      "nullable": true
    },
    {
      "path": "temperature",
      "type": "number",
      "meaning": "采样温度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "timeout",
      "type": "number",
      "meaning": "请求超时，单位秒",
      "optional": true,
      "nullable": true
    },
    {
      "path": "maxToken",
      "type": "number",
      "meaning": "最大Token数",
      "optional": true,
      "nullable": true
    }
  ],
  "AiModelSelectionDTO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callType",
      "type": "number",
      "meaning": "调用类型：1APP对话/2Web对话/3后端调用/4前端意图识别",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callTypeName",
      "type": "string",
      "meaning": "调用类型显示名",
      "optional": true,
      "nullable": true
    },
    {
      "path": "skillIds",
      "type": "string",
      "meaning": "技能ID英文逗号串",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createId",
      "type": "number | string",
      "meaning": "创建人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateId",
      "type": "number | string",
      "meaning": "修改人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "修改时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "remark",
      "type": "string",
      "meaning": "备注",
      "optional": true,
      "nullable": true
    },
    {
      "path": "delFlag",
      "type": "number",
      "meaning": "删除标记",
      "optional": true,
      "nullable": true
    },
    {
      "path": "skillIdList",
      "type": "array",
      "meaning": "技能ID数组",
      "optional": true,
      "nullable": true
    },
    {
      "path": "skillNames",
      "type": "string",
      "meaning": "技能名称展示串",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelNames",
      "type": "string",
      "meaning": "模型名称展示串",
      "optional": true,
      "nullable": true
    },
    {
      "path": "details",
      "type": "array",
      "meaning": "按业务用途配置的模型明细数组",
      "optional": true,
      "nullable": true
    }
  ],
  "AiModelSelectionDetailDTO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelSelectionId",
      "type": "number | string",
      "meaning": "所属模型选择配置ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "code",
      "type": "string",
      "meaning": "用途码：model对话/extract_param抽参/multimodal多模态/analysis_report报告/intent_recognition意图/app_intent_recognition APP意图/pc_intent_recognition PC意图",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "isDefault",
      "type": "number",
      "meaning": "1默认模型，0备选",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createId",
      "type": "number | string",
      "meaning": "创建人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateId",
      "type": "number | string",
      "meaning": "修改人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "修改时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "remark",
      "type": "string",
      "meaning": "备注",
      "optional": true,
      "nullable": true
    },
    {
      "path": "delFlag",
      "type": "number",
      "meaning": "删除标记",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelName",
      "type": "string",
      "meaning": "模型名称",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenQuotaRuleRespVO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "ruleScope",
      "type": "number",
      "meaning": "规则作用范围",
      "optional": true,
      "nullable": true
    },
    {
      "path": "memberLevel",
      "type": "number",
      "meaning": "会员等级：1-个人用户，2-企业用户-免费，3-企业用户-初级，4-企业用户-中级，5-企业用户-高级",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetTenantId",
      "type": "number | string",
      "meaning": "目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetTenantName",
      "type": "string",
      "meaning": "目标租户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetUserPhone",
      "type": "string",
      "meaning": "目标用户手机号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetUserName",
      "type": "string",
      "meaning": "目标用户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetUserTypeName",
      "type": "string",
      "meaning": "目标用户类型",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalQuota",
      "type": "number | string",
      "meaning": "总额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaCheckEnabled",
      "type": "boolean",
      "meaning": "是否开启额度校验",
      "optional": true,
      "nullable": true
    },
    {
      "path": "carryOverRule",
      "type": "number",
      "meaning": "结转规则：1-当天有效（不结转），2-未用结转（累积模式）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "resetCycle",
      "type": "number",
      "meaning": "重置周期",
      "optional": true,
      "nullable": true
    },
    {
      "path": "shortageStrategy",
      "type": "number",
      "meaning": "额度不足策略",
      "optional": true,
      "nullable": true
    },
    {
      "path": "startTime",
      "type": "string",
      "meaning": "生效开始时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "endTime",
      "type": "string",
      "meaning": "生效结束时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "规则原因",
      "optional": true,
      "nullable": true
    },
    {
      "path": "enabled",
      "type": "boolean",
      "meaning": "是否启用",
      "optional": true,
      "nullable": true
    },
    {
      "path": "dailyQuota",
      "type": "number | string",
      "meaning": "日额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "weeklyQuota",
      "type": "number | string",
      "meaning": "周额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usedQuota",
      "type": "number | string",
      "meaning": "已使用额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "remainingQuota",
      "type": "number | string",
      "meaning": "剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usageStatus",
      "type": "number",
      "meaning": "用量状态：0-未分配，1-正常，2-预警，3-已用尽",
      "optional": true,
      "nullable": true
    },
    {
      "path": "memberLevelName",
      "type": "string",
      "meaning": "会员等级名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "resetCycleName",
      "type": "string",
      "meaning": "重置周期名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "shortageStrategyName",
      "type": "string",
      "meaning": "余额不足处理方法名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "carryOverRuleName",
      "type": "string",
      "meaning": "结转规则名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseTotalQuota",
      "type": "number | string",
      "meaning": "基础总额度（通用规则值）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseDailyQuota",
      "type": "number | string",
      "meaning": "基础日额度（通用规则折算）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseWeeklyQuota",
      "type": "number | string",
      "meaning": "基础周额度（通用规则折算）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantId",
      "type": "number | string",
      "meaning": "记录所属租户ID，不是目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "creator",
      "type": "string",
      "meaning": "创建人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updater",
      "type": "string",
      "meaning": "更新人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "更新时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "deleted",
      "type": "boolean",
      "meaning": "逻辑删除标记",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenFlowRuleRespVO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "ruleScope",
      "type": "number",
      "meaning": "规则作用范围",
      "optional": true,
      "nullable": true
    },
    {
      "path": "memberLevel",
      "type": "number",
      "meaning": "会员等级：1-个人用户，2-企业用户-免费，3-企业用户-初级，4-企业用户-中级，5-企业用户-高级",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetTenantId",
      "type": "number | string",
      "meaning": "目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetTenantName",
      "type": "string",
      "meaning": "目标租户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetUserPhone",
      "type": "string",
      "meaning": "目标用户手机号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetUserName",
      "type": "string",
      "meaning": "目标用户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetUserTypeName",
      "type": "string",
      "meaning": "目标用户类型",
      "optional": true,
      "nullable": true
    },
    {
      "path": "flowCheckEnabled",
      "type": "boolean",
      "meaning": "是否开启限速校验",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tokenLimitPerMinute",
      "type": "number | string",
      "meaning": "每分钟Token限制",
      "optional": true,
      "nullable": true
    },
    {
      "path": "maxTokenPerRequest",
      "type": "number",
      "meaning": "单次请求最大Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "exceedStrategy",
      "type": "number",
      "meaning": "超限策略",
      "optional": true,
      "nullable": true
    },
    {
      "path": "startTime",
      "type": "string",
      "meaning": "生效开始时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "endTime",
      "type": "string",
      "meaning": "生效结束时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "规则原因",
      "optional": true,
      "nullable": true
    },
    {
      "path": "recentMinuteTokens",
      "type": "number | string",
      "meaning": "最近一分钟 Token 数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usageStatus",
      "type": "number",
      "meaning": "用量状态：0-未分配，1-正常，2-预警，3-已用尽",
      "optional": true,
      "nullable": true
    },
    {
      "path": "memberLevelName",
      "type": "string",
      "meaning": "会员等级名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "exceedStrategyName",
      "type": "string",
      "meaning": "限速处理方法名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseTokenLimitPerMinute",
      "type": "number | string",
      "meaning": "基础每分钟Token限制（通用规则值）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseMaxTokenPerRequest",
      "type": "number",
      "meaning": "基础单次最大Token（通用规则值）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantId",
      "type": "number | string",
      "meaning": "记录所属租户ID，不是目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "creator",
      "type": "string",
      "meaning": "创建人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updater",
      "type": "string",
      "meaning": "更新人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "更新时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "deleted",
      "type": "boolean",
      "meaning": "逻辑删除标记",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenQuotaApplyRespVO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelName",
      "type": "string",
      "meaning": "模型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userId",
      "type": "number | string",
      "meaning": "用户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userPhone",
      "type": "string",
      "meaning": "申请用户手机号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userName",
      "type": "string",
      "meaning": "用户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentMonthlyQuota",
      "type": "number | string",
      "meaning": "当前月度额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "expectedMonthlyQuota",
      "type": "number | string",
      "meaning": "期望月度额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentMaxToken",
      "type": "number",
      "meaning": "当前单次最大Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "expectedMaxToken",
      "type": "number",
      "meaning": "期望单次最大Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "申请原因",
      "optional": true,
      "nullable": true
    },
    {
      "path": "rejectReason",
      "type": "string",
      "meaning": "驳回原因",
      "optional": true,
      "nullable": true
    },
    {
      "path": "status",
      "type": "number",
      "meaning": "申请状态：0-待处理，3-已驳回，4-已处理",
      "optional": true,
      "nullable": true
    },
    {
      "path": "applyTarget",
      "type": "number",
      "meaning": "申请流转目标：1-租户管理员，2-平台",
      "optional": true,
      "nullable": true
    },
    {
      "path": "handlerId",
      "type": "number | string",
      "meaning": "处理人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "handlerName",
      "type": "string",
      "meaning": "处理人名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "handledTime",
      "type": "string",
      "meaning": "处理时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "statusName",
      "type": "string",
      "meaning": "状态名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantName",
      "type": "string",
      "meaning": "租户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantId",
      "type": "number | string",
      "meaning": "记录所属租户ID，不是目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "creator",
      "type": "string",
      "meaning": "创建人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updater",
      "type": "string",
      "meaning": "更新人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "更新时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "deleted",
      "type": "boolean",
      "meaning": "逻辑删除标记",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenAdjustHistoryRespVO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "configType",
      "type": "number",
      "meaning": "配置类型",
      "optional": true,
      "nullable": true
    },
    {
      "path": "ruleScope",
      "type": "number",
      "meaning": "规则作用范围",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetId",
      "type": "number | string",
      "meaning": "目标ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetPhone",
      "type": "string",
      "meaning": "目标用户手机号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "targetName",
      "type": "string",
      "meaning": "目标名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "actionType",
      "type": "string",
      "meaning": "操作类型",
      "optional": true,
      "nullable": true
    },
    {
      "path": "beforeValue",
      "type": "number | string",
      "meaning": "调整前的值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "afterValue",
      "type": "number | string",
      "meaning": "调整后的值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "beforeMaxToken",
      "type": "number",
      "meaning": "调整前的单次最大Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "afterMaxToken",
      "type": "number",
      "meaning": "调整后的单次最大Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "reason",
      "type": "string",
      "meaning": "调整原因",
      "optional": true,
      "nullable": true
    },
    {
      "path": "operatorId",
      "type": "number | string",
      "meaning": "操作人ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "operatorName",
      "type": "string",
      "meaning": "操作人名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "operateTime",
      "type": "string",
      "meaning": "操作时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "ruleScopeName",
      "type": "string",
      "meaning": "规则作用范围名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "actionTypeName",
      "type": "string",
      "meaning": "操作类型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "changeValue",
      "type": "string",
      "meaning": "调整额度（afterValue-beforeValue，带正负号）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantId",
      "type": "number | string",
      "meaning": "记录所属租户ID，不是目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "creator",
      "type": "string",
      "meaning": "创建人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updater",
      "type": "string",
      "meaning": "更新人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "更新时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "deleted",
      "type": "boolean",
      "meaning": "逻辑删除标记",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenQuotaUsageRespVO": [
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型编号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelName",
      "type": "string",
      "meaning": "模型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantName",
      "type": "string",
      "meaning": "租户名称，统计维度为 3-平台时返回",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaCycle",
      "type": "number",
      "meaning": "额度周期：1-日额度，2-周额度，3-月额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "cycleQuota",
      "type": "number | string",
      "meaning": "周期总额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "monthlyQuota",
      "type": "number | string",
      "meaning": "月额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "weeklyQuota",
      "type": "number | string",
      "meaning": "周额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "dailyQuota",
      "type": "number | string",
      "meaning": "日额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usedQuota",
      "type": "number | string",
      "meaning": "已用额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "remainingQuota",
      "type": "number | string",
      "meaning": "剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usageRate",
      "type": "number",
      "meaning": "使用率百分比",
      "optional": true,
      "nullable": true
    },
    {
      "path": "maxTokenPerRequest",
      "type": "number",
      "meaning": "单次最大 Token",
      "optional": true,
      "nullable": true
    },
    {
      "path": "resetTime",
      "type": "string",
      "meaning": "额度重置时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usageStatus",
      "type": "number",
      "meaning": "用量状态：0-未分配，1-正常，2-预警，3-已耗尽",
      "optional": true,
      "nullable": true
    },
    {
      "path": "usageStatusName",
      "type": "string",
      "meaning": "用量状态名称",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenQuotaUsageSummaryRespVO": [
    {
      "path": "cycleTotalQuota",
      "type": "number | string",
      "meaning": "周期总额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "cycleUsedQuota",
      "type": "number | string",
      "meaning": "周期已用额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "cycleRemainingQuota",
      "type": "number | string",
      "meaning": "周期剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleAvailableQuota",
      "type": "number | string",
      "meaning": "当前周期可用额度",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenUsageRecordRespVO": [
    {
      "path": "id",
      "type": "number | string",
      "meaning": "主键ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "requestId",
      "type": "string",
      "meaning": "请求ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "functionModule",
      "type": "string",
      "meaning": "功能模块",
      "optional": true,
      "nullable": true
    },
    {
      "path": "chargeTargetType",
      "type": "number",
      "meaning": "计费目标类型",
      "optional": true,
      "nullable": true
    },
    {
      "path": "phone",
      "type": "string",
      "meaning": "用户手机号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userName",
      "type": "string",
      "meaning": "用户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "memberLevel",
      "type": "number",
      "meaning": "会员等级：1-个人用户，2-企业用户-免费，3-企业用户-初级，4-企业用户-中级，5-企业用户-高级",
      "optional": true,
      "nullable": true
    },
    {
      "path": "inputTokens",
      "type": "number",
      "meaning": "输入Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "outputTokens",
      "type": "number",
      "meaning": "输出Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokens",
      "type": "number",
      "meaning": "总Token数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "consumedQuota",
      "type": "number | string",
      "meaning": "消耗的额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaDeducted",
      "type": "boolean",
      "meaning": "是否已扣减额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaBefore",
      "type": "number | string",
      "meaning": "扣减前额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaAfter",
      "type": "number | string",
      "meaning": "扣减后额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantQuotaAfter",
      "type": "number | string",
      "meaning": "扣减后租户总池剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaRuleId",
      "type": "number | string",
      "meaning": "额度规则ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "flowRuleId",
      "type": "number | string",
      "meaning": "限流规则ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "maxTokenLimit",
      "type": "number",
      "meaning": "单次最大Token限制",
      "optional": true,
      "nullable": true
    },
    {
      "path": "windowUsedTokens",
      "type": "number",
      "meaning": "窗口已用Token（命中流速规则的每分钟窗口内累计Token）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callStatus",
      "type": "number",
      "meaning": "调用状态",
      "optional": true,
      "nullable": true
    },
    {
      "path": "limitType",
      "type": "string",
      "meaning": "限制类型",
      "optional": true,
      "nullable": true
    },
    {
      "path": "durationMs",
      "type": "number",
      "meaning": "耗时(毫秒)",
      "optional": true,
      "nullable": true
    },
    {
      "path": "requestSummary",
      "type": "string",
      "meaning": "请求摘要",
      "optional": true,
      "nullable": true
    },
    {
      "path": "errorCode",
      "type": "string",
      "meaning": "错误码",
      "optional": true,
      "nullable": true
    },
    {
      "path": "failureReason",
      "type": "string",
      "meaning": "失败原因",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callTime",
      "type": "string",
      "meaning": "调用时间；服务端时间字符串，未声明时区时勿自行转换",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantQuotaBefore",
      "type": "number | string",
      "meaning": "扣减前租户总池余额",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaRuleTotalQuota",
      "type": "number | string",
      "meaning": "命中额度规则的总额度快照",
      "optional": true,
      "nullable": true
    },
    {
      "path": "flowRuleTokenLimit",
      "type": "number | string",
      "meaning": "命中流速规则的每分钟上限快照",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseQuotaTotal",
      "type": "number | string",
      "meaning": "基础通用规则总额度快照（调用时通用规则值）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseMaxToken",
      "type": "number",
      "meaning": "基础通用规则单次最大Token快照",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelName",
      "type": "string",
      "meaning": "模型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantName",
      "type": "string",
      "meaning": "租户名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userName",
      "type": "string",
      "meaning": "使用人名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userBelongName",
      "type": "string",
      "meaning": "用户归属",
      "optional": true,
      "nullable": true
    },
    {
      "path": "memberLevelName",
      "type": "string",
      "meaning": "会员等级名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "deductToken",
      "type": "string",
      "meaning": "本次扣减来源：个人额度 / 租户额度 / 未扣额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tokenLimitPerMinute",
      "type": "number | string",
      "meaning": "每分钟上限（命中流速规则的 token_limit_per_minute）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "flowLimited",
      "type": "string",
      "meaning": "是否触发限流：是 / 否",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userRemainingQuota",
      "type": "number | string",
      "meaning": "用户剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "userRemainingQuotaDisplay",
      "type": "string",
      "meaning": "用户剩余额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantRemainingQuota",
      "type": "number | string",
      "meaning": "租户剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantRemainingQuotaDisplay",
      "type": "string",
      "meaning": "租户剩余额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callStatusName",
      "type": "string",
      "meaning": "调用状态名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "durationMsStr",
      "type": "string",
      "meaning": "耗时（秒）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "consumedQuotaDisplay",
      "type": "string",
      "meaning": "消耗额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaBeforeDisplay",
      "type": "string",
      "meaning": "扣减前额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaAfterDisplay",
      "type": "string",
      "meaning": "扣减后额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantQuotaAfterDisplay",
      "type": "string",
      "meaning": "扣减后租户总池剩余额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantQuotaBefore",
      "type": "number | string",
      "meaning": "扣减前租户总池余额",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantQuotaBeforeDisplay",
      "type": "string",
      "meaning": "扣减前租户总池余额展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaRuleTotalQuota",
      "type": "number | string",
      "meaning": "命中额度规则总额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaRuleTotalQuotaDisplay",
      "type": "string",
      "meaning": "命中额度规则总额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "flowRuleTokenLimit",
      "type": "number | string",
      "meaning": "命中流速规则每分钟上限",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseQuotaTotal",
      "type": "number | string",
      "meaning": "基础通用规则总额度快照",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseQuotaTotalDisplay",
      "type": "string",
      "meaning": "基础通用规则总额度快照展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "baseMaxToken",
      "type": "number",
      "meaning": "基础通用规则单次最大Token快照",
      "optional": true,
      "nullable": true
    },
    {
      "path": "tenantId",
      "type": "number | string",
      "meaning": "记录所属租户ID，不是目标租户ID",
      "optional": true,
      "nullable": true
    },
    {
      "path": "creator",
      "type": "string",
      "meaning": "创建人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updater",
      "type": "string",
      "meaning": "更新人标识",
      "optional": true,
      "nullable": true
    },
    {
      "path": "createTime",
      "type": "string",
      "meaning": "创建时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "updateTime",
      "type": "string",
      "meaning": "更新时间",
      "optional": true,
      "nullable": true
    },
    {
      "path": "deleted",
      "type": "boolean",
      "meaning": "逻辑删除标记",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenUsageSummaryRespVO": [
    {
      "path": "statisticsRange",
      "type": "string",
      "meaning": "统计范围",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalConsumedQuota",
      "type": "number | string",
      "meaning": "总消耗额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalConsumedQuotaDisplay",
      "type": "string",
      "meaning": "总消耗额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalCallCount",
      "type": "number | string",
      "meaning": "总调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "successCallCount",
      "type": "number | string",
      "meaning": "成功调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "limitedCallCount",
      "type": "number | string",
      "meaning": "限流调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "quotaNotEnoughCallCount",
      "type": "number | string",
      "meaning": "额度不足调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "failedCallCount",
      "type": "number | string",
      "meaning": "失败调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "inputTokens",
      "type": "number | string",
      "meaning": "输入 Token 总数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "inputTokensDisplay",
      "type": "string",
      "meaning": "输入 Token 总数展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "outputTokens",
      "type": "number | string",
      "meaning": "输出 Token 总数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "outputTokensDisplay",
      "type": "string",
      "meaning": "输出 Token 总数展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokens",
      "type": "number | string",
      "meaning": "Token 总数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokensDisplay",
      "type": "string",
      "meaning": "Token 总数展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "maxSingleTokens",
      "type": "number",
      "meaning": "单次最大 Token 数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "avgSingleTokens",
      "type": "number | string",
      "meaning": "平均单次 Token 数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "averageConsumedQuota",
      "type": "number | string",
      "meaning": "平均单次消耗额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "averageConsumedQuotaDisplay",
      "type": "string",
      "meaning": "平均单次消耗额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "mostConsumedModelId",
      "type": "number | string",
      "meaning": "消耗最多模型编号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "mostConsumedModelName",
      "type": "string",
      "meaning": "消耗最多模型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "mostConsumedModelRate",
      "type": "number",
      "meaning": "消耗最多模型占比百分比",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleQuota",
      "type": "number | string",
      "meaning": "当前周期额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleQuotaDisplay",
      "type": "string",
      "meaning": "当前周期额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleUsedQuota",
      "type": "number | string",
      "meaning": "当前周期已消耗额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleUsedQuotaDisplay",
      "type": "string",
      "meaning": "当前周期已消耗额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleRemainingQuota",
      "type": "number | string",
      "meaning": "当前周期剩余额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "currentCycleRemainingQuotaDisplay",
      "type": "string",
      "meaning": "当前周期剩余额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "maxTokenPerRequest",
      "type": "number",
      "meaning": "单次最大 Token",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenUsageTrendRespVO": [
    {
      "path": "date",
      "type": "string",
      "meaning": "日期",
      "optional": true,
      "nullable": true
    },
    {
      "path": "consumedQuota",
      "type": "number | string",
      "meaning": "消耗额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "consumedQuotaDisplay",
      "type": "string",
      "meaning": "消耗额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callCount",
      "type": "number | string",
      "meaning": "调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokens",
      "type": "number | string",
      "meaning": "合计使用量（输入 + 输出 Token 数）",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokensDisplay",
      "type": "string",
      "meaning": "合计使用量展示值",
      "optional": true,
      "nullable": true
    }
  ],
  "AiTokenUsageGroupRespVO": [
    {
      "path": "modelId",
      "type": "number | string",
      "meaning": "模型编号",
      "optional": true,
      "nullable": true
    },
    {
      "path": "modelName",
      "type": "string",
      "meaning": "模型名称",
      "optional": true,
      "nullable": true
    },
    {
      "path": "functionModule",
      "type": "string",
      "meaning": "功能模块",
      "optional": true,
      "nullable": true
    },
    {
      "path": "consumedQuota",
      "type": "number | string",
      "meaning": "消耗额度",
      "optional": true,
      "nullable": true
    },
    {
      "path": "consumedQuotaDisplay",
      "type": "string",
      "meaning": "消耗额度展示值",
      "optional": true,
      "nullable": true
    },
    {
      "path": "callCount",
      "type": "number | string",
      "meaning": "调用次数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokens",
      "type": "number | string",
      "meaning": "Token 总数",
      "optional": true,
      "nullable": true
    },
    {
      "path": "totalTokensDisplay",
      "type": "string",
      "meaning": "Token 总数展示值",
      "optional": true,
      "nullable": true
    }
  ]
}

const f = (path: string, type: string, meaning: string, nullable = false): AiField => ({ path, type, meaning, ...(nullable ? { nullable } : {}) })
const p = (meaning: string, source: string, format?: string): AiParameter => ({ meaning, source, ...(format ? { format } : {}) })
// RespVO redeclares some inherited fields; the derived definition is authoritative.
const rows = (name: string, root = '') => [...new Map((schemas[name] ?? []).map(field => [field.path, field])).values()].map(field => ({ ...field, path: root ? `${root}.${field.path}` : field.path }))
const page = (name: string): AiContract['output'] => ({ shape: '{ list: object[], total: number }', fields: [f('list','array','当前页记录；嵌套字段见下'), ...rows(name,'list[]'), f('total','number','筛选后总记录数，不是当前页数量')], empty: 'list=[]为当前页没有记录；高页码空页不证明整个筛选为空。' })
const detail = (name: string): AiContract['output'] => ({ shape: 'object | null（后端data已拆除包络）', fields: rows(name), empty: '详情不存在可能为null或后端错误；不能凭空创建替代记录。' })
const nullReceipt: AiContract['output'] = { shape: 'null', fields: [f('$','null','后端成功data为null，没有新ID；需独立回查业务记录')], empty: 'null是成功回执；请求失败会抛错，不能用布尔真假判断。' }
const boolReceipt: AiContract['output'] = { shape: 'boolean', fields: [f('$','boolean','后端是否成功的data值；还需回查目标记录核实')], empty: 'false不可当成成功；异常由请求层抛出。' }
const ruleReceipt: AiContract['output'] = { shape: 'number | string（新建ID）或 boolean（修改结果）', fields: [f('$','number | string | boolean','无id新建返回规则ID；带id修改返回成功布尔值，不是规则ID')], empty: '修改true只表示请求处理成功，须get读取确认目标字段。' }
const next = (capabilityId: string, instruction: string, mapping?: Record<string,string>, role: 'required'|'optional'|'recovery'|'cancel'='optional'): AiContract['steps'][number] => ({role,when:instruction,capabilityId,instruction,...(mapping?{mapping}:{})})
const method = (sdkPath: string, instruction: string, role: 'required'|'optional'|'recovery'|'cancel'='optional', mapping?: Record<string,string>): AiContract['steps'][number] => ({role,when:instruction,sdkPath,instruction,...(mapping?{mapping}:{})})
const done = (instruction:string): AiContract['steps'] => [{role:'optional',when:'已满足用户查询目的',instruction}]
const values: Record<string,Record<string,string>> = {
 availableStatus:{'0':'未测试','1':'正常','2':'异常'},ruleScope:{'1':'通用','2':'租户','3':'个人'},memberLevel:{'1':'个人用户','2':'企业免费','3':'企业初级','4':'企业中级','5':'企业高级'},resetCycle:{'0':'不重置','1':'日','2':'周','3':'月'},quotaCycle:{'1':'日','2':'周','3':'月'},carryOverRule:{'1':'当天有效不结转','2':'未用结转'},shortageStrategy:{'1':'禁止使用','2':'提醒'},exceedStrategy:{'1':'禁止使用','2':'降速','3':'提醒'},usageStatus:{'0':'未分配','1':'正常','2':'预警','3':'已用尽'},callStatus:{'1':'成功','2':'限流','3':'额度不足','4':'失败'},callType:{'1':'APP对话','2':'Web对话','3':'后端调用','4':'前端意图识别'},configType:{'1':'额度','2':'流速'},isDefault:{'0':'备选','1':'默认'},status:{'0':'待处理','3':'已驳回','4':'已处理'},applyTarget:{'1':'租户管理员','2':'平台'},limitType:{FLOW:'流速限制',QUOTA:'额度不足'},chargeTargetType:{'1':'个人','2':'租户'},
}
for (const fields of Object.values(schemas)) for(const field of fields) if(values[field.path]) field.values=values[field.path]
const applyStatusField=schemas.AiTokenQuotaApplyRespVO!.find(field=>field.path==='status')!
applyStatusField.constraints=['这里的0/3/4是当前Java状态定义；页面展示优先statusName，其次平台字典ai_token_quota_apply_status，再兼容标签0待处理/1已忽略/2已填写/3已驳回，均缺失时显示“-”。显示旧1/2不代表写入允许1/2。','Portal仅原始数字status===0时显示一键填写和忽略按钮。']
schemas.AiTokenQuotaApplyRespVO!.find(field=>field.path==='statusName')!.meaning='Portal状态列优先显示的服务端标签；空字符串/null/缺失时依次查平台字典、页面兼容标签，最后显示“-”'
const sourceByParam: Record<string,string> = {
 modelId:'ai-model-list.list[].id 或 ai-model-available-list[].id；不能用模型名称代替ID',
 targetTenantId:'base-tenant-list.tenants[].id（先keyword搜企业）；仅覆盖当前用户所属企业，平台管理其它企业时本候选不完整',
 tenantId:'base-tenant-list.tenants[].id；不能用名称当ID',
 targetTenantName:'与targetTenantId同一候选tenants[].name',
 targetUserPhone:'ai-model-search-user.list[].phone；不是base-user-search.id',
 targetUserName:'与targetUserPhone同一候选list[].userName',
 targetUserTypeName:'与targetUserPhone同一候选list[].tradeStr',
 targetUserId:'申请行userId或用户候选id；当前流速查询后端VO未消费此参数，不可依赖它收窄范围',
 functionModule:'platform-usage-function-module-list返回的字符串项',
 skillIds:'ai-prompt-skill-list({name:用户关键字,isPublish:1}).list[].id，确认isPublish=1；不是模型ID',
 details:'modelId来自ai-model-available-list[].id，code按用途表，isDefault选择1默认或0备选',
 testResult:'ai-model-test返回的status与supportedFiles，不能自行伪造正常测试结果',
 apiKey:'接入方提供的模型密钥；不从掩码apiKeyMasked恢复，不在日志或对话展示',
 requestId:'平台用量记录中的requestId，用于查询定位，绝非写入幂等键',
}
const evidence:AiContract['evidence']=[{source:'src/capabilities/ai-model-compat.ts',kind:'implementation',note:'0/3/4本地校验、phone目标及部分写入错误回执；独立适配器避免依赖并行未提交模块'},{source:'src/capabilities/ai-model.ts',kind:'implementation',note:'SDK原样透传data；prepare/save/restore及参数装配逐项核对'},{source:'baseline/ai-model.browser.json',kind:'browser',note:'历史23条GET请求，仅证明请求形状，不包含响应字段基准或写入闭环'},{source:'backend@dcb3f360194:erp-module-ai DTO/RespVO/DO/Controller',kind:'reference',note:'返回结构与状态由当前后端源码辅助推导；不是线上响应实测'},{source:'frontend@d3cf56bdc76:interaction/model、modelSelect、common/model-usage',kind:'reference',note:'核对候选字段映射、默认周期和展示消费'}]
const networkErrors=['401或403先核对会话/租户及实际动作权限；菜单可见性不是权限裁决。','参数和形状错误保留原始消息；空页与请求失败不能混同。']
const writeErrors=['本族写入没有SDK requestId防重，超时先回查，不盲目重发。','成功回执不代替独立核实；删除不可恢复，恢复旧配置是另一次真实写入。',...networkErrors]
const applyVerificationLimit='兼容适配器按后端dcb3f360194确认0/3/4和手机号规则，已有离线SDK执行验证；未在部署环境重放真实申请写入。前端d3cf56bdc76仍用旧1/2，SDK拒绝且不自动映射，Portal待处理行仍显示“忽略”并固定发送1，Java查询与处理VO均以@InEnum拒绝1/2；这是页面与当前协议冲突，不是缺少用户业务决策。'
const applyIgnoreGap='Portal申请记录的待处理行可见“忽略”按钮，useApplyModals固定发送status=1；当前Java处理接口@Valid/@InEnum仅接受0/3/4。SDK暂不能完成页面忽略操作，不自动映射为驳回或已处理；需要Portal与Java协议对齐证据。'
const definitions=ALL_CAPABILITY_DEFINITIONS.filter(d=>d.id.startsWith('ai-model-')||d.id.startsWith('platform-usage-')||d.id==='data-analysis-overview')
function make(id:string, spec: Omit<AiContract,'inputs'|'prerequisites'|'effect'|'failures'|'idempotency'|'evidence'> & Partial<Pick<AiContract,'inputs'|'prerequisites'|'effect'|'failures'|'idempotency'|'evidence'>>):AiContract {
 const d=definitions.find(d=>d.id===id)
 const inputs:Record<string,AiParameter>={}
 for(const param of d?.params??[]) inputs[param.name]={
  ...p(param.description??param.name,sourceByParam[param.name]??'用户明确的业务条件；枚举按本参数options填写', ['pageNo','pageSize'].includes(param.name)?'整数；pageNo从1开始，pageSize建议1–50；SDK此族不自动限制上限':undefined),
  type: param.kind==='number'?'number':param.kind==='boolean'?'boolean':param.kind==='enum'?[...new Set(param.options?.map(o=>typeof o.value)??['string','number'])].join(' | '):param.kind==='search'?'number | string':'string',
  required:param.required,
  ...(param.options?{constraints:['可选值：'+param.options.map(o=>`${o.value}=${o.label}`).join('；')]}:{}),
 }
 const mergedInputs={...inputs}
 for(const [key,value] of Object.entries(spec.inputs??{}))mergedInputs[key]={...inputs[key],...value}

 return {effect:d?.write?'write':'read',prerequisites:['当前用户租户会话；此族platform实例，页面无module-type映射时不发该头。'],failures:d?.write?writeErrors:networkErrors,idempotency:d?.write?'无自动幂等保护；发生不确定结果时先按目标ID/业务键读取确认。':null,evidence,...spec,inputs:mergedInputs}
}
const contracts:Record<string,AiContract>={}
const modelInput={id:p('可选模型ID；无/null新建，有值修改','ai-model-list.list[].id 或 ai-model-detail.id'),dropApiKey:p('修改不重新输入密钥时true，整个apiKey键不发送；新建不能靠此跳过后端必填','用户明确保留原密钥时设置','boolean'),'testResult.status':p('测试结果1正常/2异常；truthy时写availableStatus','ai-model-test.status'),'testResult.supportedFiles':p('支持文件类型串','ai-model-test.supportedFiles')}
contracts['ai-model-list']=make('ai-model-list',{purpose:'按名称分页查询全部模型配置，取得管理ID与当前可用状态。',whenToUse:'查找模型或排查配置；选择实际可用候选用available-list。',boundaries:['包括不可用配置；SDK不做白名单脱敏，当前后端列表可能包含apiKey字段，不展示或记录密钥。'],output:page('AiModelConfigDTO'),consume:['展示modelName/description/availableStatusName；用id进入详情，不把apiKeyMasked当密钥。','list是当前页，需全量统计时按total翻页，不汇总一页冒充全部。'],steps:[next('ai-model-detail','选定模型后读完整配置',{id:'result.list[].id'})],completion:'交付匹配模型及分页完整性。'})
contracts['ai-model-detail']=make('ai-model-detail',{purpose:'按模型ID读取当前配置，为编辑和恢复取得旧值。',whenToUse:'修改前核对单模型；查询不会测试上游连通性。',boundaries:['当前后端getById未清apiKey/authToken，SDK透传；不要假定只有掩码，不输出密钥。'],inputs:{id:p('模型配置主键','ai-model-list.list[].id')},output:detail('AiModelConfigDTO'),consume:['保存旧值用于回滚；测试连通性需显式调用test，availableStatus只是已保存状态。'],steps:[method('aiModel.prepareSaveModel','要修改时用当前完整字段构建草稿后prepare')],completion:'当前配置已读取，敏感字段未向用户展示。'})
contracts['ai-model-available-list']=make('ai-model-available-list',{purpose:'取得可用于模型选择的模型候选。',whenToUse:'配置模型选择details[].modelId或规则modelId。',boundaries:['后端无参数全量返回；keyword只是本地名称过滤，不减少网络量。','当前后端此入口明确将apiKey/authToken置null，与列表/详情不一致。'],output:{shape:'AiModelConfigDTO[]',fields:rows('AiModelConfigDTO','[]'),empty:'[]为无可用候选或keyword无匹配。'},consume:['展示modelName，以id填模型参数；不能拿它的id当skillIds。'],steps:[next('ai-model-selection-save','用户已有调用类型、用途和默认/备选选择时组装details，不自动提交',{'details[].modelId':'result.[].id'})],completion:'候选已交付或选定模型ID。'})
contracts['ai-model-save']=make('ai-model-save',{purpose:'实际新建或更新模型配置，包括API端点及可选密钥。',whenToUse:'用户明确保存配置；检查草稿先用prepareSaveModel。',boundaries:['立即POST，不是准备提交；新增/修改回执均null，不能当新ID。','SDK要求modelName/description/apiUrl非空；dropApiKey不为true时apiKey也必填，修改少字段可能清空旧值。','新增API地址后端要求以/chat/completions结尾；testResult只有status truthy时才写可用状态和文件支持串。'],inputs:modelInput,output:nullReceipt,consume:['新增按modelName回查精确匹配，唯一性不保证；修改按id重读比对。'],steps:[method('aiModel.prepareSaveModel','保存之前先读取旧行并保留current','required'),next('ai-model-list','新增保存后按输入modelName回查',{modelName:'args.modelName'},'required'),method('aiModel.cancelCreatedModel','要撤销本次新增且名字唯一时使用','cancel'),method('aiModel.restoreModel','要撤销修改时传prepare.current；密钥只有options.apiKey显式给出才恢复','cancel')],completion:'回查模型的目标字段与预期一致；仅收到null回执不算验证。'})
contracts['ai-model-delete']=make('ai-model-delete',{purpose:'永久删除一个模型配置。',whenToUse:'明确清理指定模型，先核实ID与模型选择引用。',boundaries:['被模型选择引用的配置后端拒绝删除；删除不能撤销。'],inputs:{id:p('待删除模型ID','ai-model-detail.id，经用户确认')},output:nullReceipt,consume:['删除后用相同id重读核实不存在；拒绝或网络错误不能解释成已删。'],steps:[next('ai-model-detail','删除后读取同一ID确认不存在',{id:'args.id'},'required')],completion:'独立查询证明目标不存在或明确报告未验证。'})
contracts['ai-model-test']=make('ai-model-test',{purpose:'调用上游模型验证连通性并返回支持文件类型。',whenToUse:'确认模型连接配置是否可用；保存状态需之后saveModel。',boundaries:['POST只探测上游，不落模型配置库；会产生上游请求，不能假定无调用成本。'],output:{shape:'{ status, message, supportedFiles }',fields:[{...f('status','number','本次连通性测试结果'),values:values.availableStatus},f('message','string','测试结果或失败说明'),f('supportedFiles','string','支持文件类型原串')],empty:'异常结果status=2仍可能正常返回对象，不等于请求层失败。'},consume:['据status/message报告本次连通性；不要把测试成功当模型已保存。'],steps:[next('ai-model-save','用户要保存本次测试状态时将结果放入testResult',{testResult:'result.$'})],completion:'已报告本次测试结果；没有隐含保存。'})
const ruleInput={id:p('可选规则ID；无/null新建，有值修改','对应规则list[].id或新增规则返回值'),ruleScope:p('1通用/2租户/3个人；决定目标字段发哪些','用户选择规则作用范围','1 | 2 | 3'),memberLevel:p('仅ruleScope=1发送：1个人/2企业免费/3初级/4中级/5高级','用户选择会员档位','1–5'),targetTenantId:p('仅ruleScope=2发送的目标企业ID','base-tenant-list.tenants[].id；当前用户企业列表不是全平台企业搜索'),targetUserPhone:p('仅ruleScope=3发送的目标手机号','ai-model-search-user.list[].phone'),targetUserTypeName:p('仅ruleScope=3发送的用户来源类型','ai-model-search-user.list[].tradeStr'),startTime:p('生效时间，必填','用户确定的生效时点','YYYY-MM-DD HH:mm:ss'),endTime:p('可选结束时间','用户确定的截止时点','YYYY-MM-DD HH:mm:ss')}
for(const [kind,label,schema,prefix] of [['quota','额度','AiTokenQuotaRuleRespVO','Quota'],['flow','流速','AiTokenFlowRuleRespVO','Flow']] as const){
 contracts[`ai-model-${kind}-rule-list`]=make(`ai-model-${kind}-rule-list`,{purpose:`查询指定模型的${label}规则，按通用/租户/个人范围区分。`,whenToUse:`检查当前${label}限制、取得规则ID以便编辑或查看历史。`,boundaries:[kind==='quota'?'额度是Token配额，不是货币；日/周/月派生额度与totalQuota不要重复相加。':'流速是每分钟Token上限和单次最大Token；targetUserId后端VO未消费，不保证按此收窄。'],output:page(schema),consume:[`展示范围、对象、${label}限制与生效时间；当前页不等于全部规则。`],steps:[method(`aiModel.get${prefix}Rule`,'需要编辑时按规则ID取详情','optional',{id:'result.list[].id'}),next('ai-model-rule-history','需要调整审计时传modelId和configType，targetId按范围取得',{modelId:'result.list[].modelId',configType:kind==='quota'?'literal:1':'literal:2'})],completion:'当前规则已说明或取得目标规则ID。'})
 contracts[`ai-model-${kind}-rule-save`]=make(`ai-model-${kind}-rule-save`,{purpose:`实际新建或更新模型的${label}规则。`,whenToUse:`用户明确配置${label}限制；准备草稿与读取旧值用prepareSave${prefix}Rule。`,boundaries:[`有id更新、无id新建；${kind==='quota'?'create/update均POST':'create为POST、update为PUT'}。`,`ruleScope仅发送对应目标字段：1会员等级、2租户ID/名、3用户手机号/名/类型，其余目标键丢弃。`,kind==='quota'?'totalQuota必须大于0，quotaCheckEnabled默认true；resetCycle、shortageStrategy须按枚举提供。':'tokenLimitPerMinute/maxTokenPerRequest必须大于0，flowCheckEnabled默认true；exceedStrategy须按枚举提供。'],inputs:ruleInput,output:ruleReceipt,consume:['新建返回ID直接用于get和cancel；修改布尔true不是新ID，仍用输入id查询。'],steps:[method(`aiModel.prepareSave${prefix}Rule`,'写前校验并保存current旧行','required'),method(`aiModel.get${prefix}Rule`,'新建以返回ID、修改以args.id保存为context.ruleId，写后get确认限制与目标','required',{id:'context.ruleId'}),method(`aiModel.cancelCreated${prefix}Rule`,'撤销新建时永久删除本次规则','cancel',{id:'result.$'}),method(`aiModel.restore${prefix}Rule`,'撤销修改时传入prepare.current旧行','cancel',{previous:'context.prepared.current'})],completion:'写后规则目标、生效时间及限制值已独立核实；需要撤销时也须再次核实。'})
 contracts[`ai-model-${kind}-rule-delete`]=make(`ai-model-${kind}-rule-delete`,{purpose:`永久删除指定${label}规则。`,whenToUse:'清理明确不用的规则或撤销本次新增。',boundaries:['DELETE带id；不可恢复，不能把删除旧规则描述成撤销修改。'],inputs:{id:p(`${label}规则主键`,`ai-model-${kind}-rule-list.list[].id或save新建返回ID`)},output:boolReceipt,consume:['使用get同ID读取验证不存在；规则被删除后模型的有效限制可能回退到其它范围规则。'],steps:[method(`aiModel.get${prefix}Rule`,'删除后确认该规则已不存在','required',{id:'args.id'})],completion:'目标规则不存在已核实，或明确报告不能核实。'})
}
contracts['ai-model-rule-history']=make('ai-model-rule-history',{purpose:'读取额度或流速规则的调整历史，解释是谁改了多少。',whenToUse:'核实一次配置修改、审计额度变化。',boundaries:['configType=1额度/2流速；targetId含义随ruleScope变化，不能总当人员ID。'],inputs:{targetId:p('通用范围取会员等级，租户范围取目标租户ID，个人范围取目标用户ID；手机号不是数字ID','所选规则与目标身份上下文；缺少可靠ID时省略并按modelId/ruleScope核对返回'),configType:p('1额度/2流速，必填','要审计的规则种类','1 | 2')},output:page('AiTokenAdjustHistoryRespVO'),consume:['展示operateTime/operatorName/actionTypeName、beforeValue/afterValue/changeValue及reason；不将每行afterValue相加。'],steps:done('交付过滤范围内的调整历史及分页情况。'),completion:'已解释目标规则变化及操作者。'})
contracts['ai-model-apply-record-list']=make('ai-model-apply-record-list',{purpose:'查询平台维度的Token提升申请与处理状态。',whenToUse:'查找申请人需求、取得申请ID以便处理。',boundaries:['固定statisticsDimension=3；需要ai-token:apply:query权限。','当前Java分页VO也校验status仅0/3/4，SDK同步拒绝1/2；省略status查询全部。Portal筛选来自平台字典ai_token_quota_apply_status，不是硬编码旧状态列表。',applyVerificationLimit],output:page('AiTokenQuotaApplyRespVO'),consume:['按Portal列展示userName、tenantName、createTime、modelName、currentMonthlyQuota、expectedMonthlyQuota、currentMaxToken、expectedMaxToken、reason及状态；id/modelId/userPhone等仅供本页操作关联，不要求额外展示。','状态显示优先statusName，再平台字典ai_token_quota_apply_status的标签，再页面兼容标签0待处理/1已忽略/2已填写/3已驳回，仍无标签显示“-”；不能把展示标签当成写接口允许值。','Portal仅status===0的行显示一键填写和忽略；忽略因当前Web/Java协议冲突不能完成，不能把SDK已有重置或驳回方法说成页面可见按钮。'],steps:[method('aiModel.prepareHandleApply','选择申请并明确目标状态后保存previousStatus','optional',{apply:'result.list[]'})],completion:'申请记录和来源状态已交付。',gaps:[]})
contracts['ai-model-apply-pending-count']=make('ai-model-apply-pending-count',{purpose:'读取平台待处理Token申请角标数。',whenToUse:'只需数量；查看内容用申请列表。',boundaries:['实际SDK方法无参数，始终statisticsDimension=3；旧参数statisticsDimension即使传1/2也不会改变范围。'],inputs:{statisticsDimension:p('兼容保留的旧声明，执行层忽略传入值并固定3平台','无需填写','实际固定3')},output:{shape:'number',fields:[f('$','number','平台待处理申请条数')],empty:'0为已确认无待处理申请；请求错误不是0。'},consume:['只报告数量，不假定各申请内容或审批权限。'],steps:[next('ai-model-apply-record-list','数量大于0且用户要查看详情时用status=0查第一页')],completion:'平台待处理数已报告。'})
contracts['ai-model-apply-handle']=make('ai-model-apply-handle',{purpose:'实际修改一个Token提升申请的处理状态；本能力不创建额度或流速规则。',whenToUse:'作为一键填写后更新状态、或既有恢复方法的底层步骤；Portal待处理行的“忽略”按钮当前存在协议冲突，不能据此宣称页面有任意状态编辑功能。',boundaries:['只POST申请状态；“已填写”状态本身不会分配额度，真正一键填写是另一个SDK方法。','SDK只接收0待处理/3已驳回/4已处理；旧1忽略/2填写写前拒绝，不猜测业务映射。',applyVerificationLimit,'rejectReason只有status=3时写入。'],inputs:{id:p('申请ID','ai-model-apply-record-list.list[].id'),status:p('目标申请状态：0待处理、3已驳回、4已处理；其他值写前拒绝','用户明确的业务决定；1忽略/2填写没有自动映射','number')},output:boolReceipt,consume:['回查申请列表的同id状态和驳回原因；不能把true当已增加Token。'],steps:[method('aiModel.prepareHandleApply','写前记录旧status','required'),next('ai-model-apply-record-list','写后按模型/用户查回同id并核实目标状态',undefined,'required'),method('aiModel.cancelHandledApply','需要恢复状态时传旧previousStatus；不会删除另建规则','cancel')],completion:'同id申请状态已独立核实；这里只完成申请状态变更，不能声称已完成页面“忽略”动作。',gaps:[applyIgnoreGap]})
contracts['ai-model-search-user']=make('ai-model-search-user',{purpose:'从跨系统用户候选取得个人Token规则使用的手机号、姓名和来源。',whenToUse:'ruleScope=3配置个人额度或流速时；不是Portal审批人ID候选。',boundaries:['服务端userName搜索，keyword必填；SDK默认20条但未硬限pageSize，调用方禁止全量拉取。'],output:{shape:'{ list: UserCandidate[], total }',fields:[f('list[].phone','string','用户手机号，个人规则targetUserPhone的实际值'),f('list[].userName','string','候选显示姓名，传targetUserName'),f('list[].tradeStr','string','用户来源/类型，传targetUserTypeName'),f('total','number','跨系统接口报告的匹配数量')],empty:'list=[]为当前页无候选；无法读取时先核对跨系统接线，不能改用Portal id代替手机号。'},consume:['以姓名与手机号区分用户；只在需要配置目标时使用手机号。'],steps:[next('ai-model-quota-rule-save','用户已确认目标人员与额度时填个人规则',{targetUserPhone:'result.list[].phone',targetUserName:'result.list[].userName',targetUserTypeName:'result.list[].tradeStr'})],completion:'取得用户确认的个人规则目标三字段。'})
const selectionFields=[...rows('AiModelSelectionDTO'),...rows('AiModelSelectionDetailDTO','details[]')]
contracts['ai-model-selection-list']=make('ai-model-selection-list',{purpose:'按调用类型查看对话、抽参、多模态等用途选用了哪些模型。',whenToUse:'查当前模型路由配置或寻找编辑对象ID。',boundaries:['callTypeList是数组，空数组不发过滤；同调用类型新增后端查重，修改不做同样查重。'],inputs:{callTypeList:p('可选调用类型数组，空数组不发；1APP/2Web/3后端/4前端意图识别','用户业务入口类型','number[]，不是单个逗号字符串')},output:{...page('AiModelSelectionDTO'),fields:[...selectionFields.map(x=>({...x,path:'list[].'+x.path})),f('total','number','全部匹配配置数量')]},consume:['展示callTypeName、modelNames、skillNames；修改前仍读detail避免使用列表缺省字段覆盖。'],steps:[next('ai-model-selection-detail','读取所选配置完整details',{id:'result.list[].id'})],completion:'已交付调用类型与模型选择概览。'})
contracts['ai-model-selection-detail']=make('ai-model-selection-detail',{purpose:'取得一条模型选择配置的用途明细与技能绑定。',whenToUse:'编辑前读取、核实保存结果或保存恢复快照。',boundaries:['details[].id是明细行ID，不是modelId；skillIds/skillIdList是技能ID，不是模型ID。'],inputs:{id:p('模型选择配置ID','ai-model-selection-list.list[].id')},output:{shape:'ModelSelectionDTO | null',fields:selectionFields,empty:'null或后端错误表示未取得目标配置；不要据此创建重复callType。'},consume:['保持每个details.code的modelId/isDefault映射；恢复草稿按code/modelId/isDefault三字段构建，skillIdList用逗号连接。'],steps:[method('aiModel.prepareSaveModelSelection','编辑时将完整旧配置折回草稿后准备')],completion:'配置和用途/技能关联已取得。'})
contracts['ai-model-selection-save']=make('ai-model-selection-save',{purpose:'实际保存调用类型到各用途默认/备选模型以及技能绑定。',whenToUse:'用户明确调整模型路由；prepare只准备草稿不会保存。',boundaries:['新增同callType只能一条；callType=2 Web对话后端要求skillIds非空。','details传数组[{code,modelId,isDefault}]；不是选中的模型ID数组，也不能用明细id代替modelId。','成功后后端清模型选择缓存；回执null不含ID。'],inputs:{id:p('无/null新建，有值修改','ai-model-selection-list.list[].id'),skillIds:p('已发布技能ID英文逗号串或number[]；Web对话必填','ai-prompt-skill-list({name:关键字,isPublish:1}).list[].id','英文逗号串或number[]'),details:p('用途模型明细数组','模型从available-list选择；code按用途枚举','Array<{code:string,modelId:number|string,isDefault:0|1}>'),'details[].code':p('model/extract_param/multimodal/analysis_report/intent_recognition/app_intent_recognition/pc_intent_recognition','按所需对话/抽参/多模态/报告/意图用途选择'),'details[].modelId':p('实际可用模型ID','ai-model-available-list[].id'),'details[].isDefault':p('1默认，0备选；按每个用途分别指定','用户选择','0 | 1')},output:nullReceipt,consume:['按callType回查唯一配置再detail核实完整用途与技能；不把null当失败自动重试。'],steps:[method('aiModel.prepareSaveModelSelection','写前保留current并处理warnings','required'),next('ai-model-selection-list','写后按callTypeList=[输入callType]核实',undefined,'required'),method('aiModel.cancelCreatedModelSelection','撤销新增时按callType唯一回查删除','cancel'),method('aiModel.restoreModelSelection','撤销修改时将旧current折回带id草稿','cancel')],completion:'回查绑定模型、默认标志与已发布技能均符合预期。'})
contracts['ai-model-selection-delete']=make('ai-model-selection-delete',{purpose:'永久删除一条调用类型模型选择配置。',whenToUse:'明确清理路由配置或撤销本次新增。',boundaries:['不可恢复；可能改变该调用类型后续模型路由行为。'],inputs:{id:p('模型选择主键','ai-model-selection-detail.id')},output:nullReceipt,consume:['记录callType和配置ID供独立核实；不会删除底层模型本身。'],steps:[next('ai-model-selection-detail','删除后同id读取确认不存在',{id:'args.id'},'required')],completion:'目标选择配置不存在已确认。'})
contracts['platform-usage-quota-list']=make('platform-usage-quota-list',{purpose:'查询平台维度各模型与企业的额度消耗和剩余情况。',whenToUse:'核对谁的配额不足；调用请求明细应选usage-list。',boundaries:['固定statisticsDimension=3平台；quotaCycle默认3月。','usageRate已经是百分比，不再次乘100；不同周期额度不能重复汇总。'],output:page('AiTokenQuotaUsageRespVO'),consume:['按modelName/tenantName展示cycleQuota、usedQuota、remainingQuota与usageStatusName；缺值不当0。'],steps:[next('platform-usage-quota-summary','需要全筛选汇总时使用相同筛选，别只累加当前页')],completion:'所选周期额度与用量已交付并说明分页范围。'})
contracts['platform-usage-quota-summary']=make('platform-usage-quota-summary',{purpose:'读取当前筛选下平台周期额度总额、已用、剩余和可用额度。',whenToUse:'展示额度汇总，不需要逐项明细时。',boundaries:['固定平台维度；quotaCycle默认3月；SDK删除pageNo/pageSize，不只统计当前页。'],output:detail('AiTokenQuotaUsageSummaryRespVO'),consume:['cycleTotalQuota/Used/Remaining是同周期口径；currentCycleAvailableQuota是当前可用值，不与remaining重复相加。'],steps:[next('platform-usage-quota-list','需要定位具体模型或企业时保持相同筛选查明细')],completion:'周期和筛选范围明确的汇总已交付。'})
const usageTime={quotaCycle:p('1日/2周/3月，调用明细默认2周；与额度页默认3月不同','用户需要的额度观察周期','1 | 2 | 3'),timeRangeType:p('1今日/2本月/3近7天/4近30天/5自定义；默认2','用户选择的调用时间区间','1–5'),startTime:p('自定义起点；纯日期补00:00:00','用户选择的日期','YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss'),endTime:p('自定义终点；纯日期补23:59:59，为闭区间','用户选择的日期','YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss')}
contracts['platform-usage-usage-list']=make('platform-usage-usage-list',{purpose:'分页查询模型调用记录，分析Token、扣减、限流和失败原因。',whenToUse:'定位某次requestId、某模型/用户的调用；汇总图用analytics。',boundaries:['平台维度固定3；quotaCycle默认2周、timeRangeType默认2本月。','requestId是被查询的模型调用编号，不是本SDK写入幂等键；输入Token、输出Token和总Token不能三项相加。'],inputs:usageTime,output:page('AiTokenUsageRecordRespVO'),consume:['展示callTime/modelName/调用状态、totalTokens、consumedQuota；durationMs是毫秒，durationMsStr是服务端秒级显示串。','quotaDeducted=false不代表模型请求必然失败，结合callStatus、limitType、failureReason判断。'],steps:[next('platform-usage-usage-detail','要查看某条调用的完整快照',{id:'result.list[].id'})],completion:'已交付对应查询记录及失败/扣减解释。'})
contracts['platform-usage-usage-detail']=make('platform-usage-usage-detail',{purpose:'读取单次模型调用的Token、扣减前后额度、命中规则和错误细节。',whenToUse:'排查明确的一条调用记录。',boundaries:['id是用量记录主键，不是requestId或模型ID；返回的是调用时规则快照，不能视作当前配置。'],inputs:{id:p('调用记录ID','platform-usage-usage-list.list[].id')},output:detail('AiTokenUsageRecordRespVO'),consume:['用callStatusName/failureReason解释结果，展示durationMs时除1000转秒；数字额度用于计算，Display字段只用于展示。'],steps:[method('aiModel.getQuotaRule','需要核对仍存在的当前额度规则时用quotaRuleId，与快照对照','optional',{id:'result.quotaRuleId'}),method('aiModel.getFlowRule','需要核对仍存在的当前流速规则时用flowRuleId','optional',{id:'result.flowRuleId'})],completion:'调用是否成功、是否扣减及限制原因已说明；已删除规则不影响历史快照解释。'})
contracts['platform-usage-usage-analytics']=make('platform-usage-usage-analytics',{purpose:'并发取得平台调用汇总、日期趋势、模型占比和技能排行。',whenToUse:'分析总体使用量或异常，单条调用用usage-detail。',boundaries:['四路独立settle，某项失败返回null并写errors；null不是零。','直接SDK第二参数options.includeBreakdowns=false只读取summary；invoke当前没有该参数，默认四项均读。','所有图使用相同筛选且去掉分页；quotaCycle默认2周、timeRangeType默认2本月。'],inputs:usageTime,output:{shape:'{ summary, trend, modelRatio, moduleRanking, errors }',fields:[f('summary','object','调用汇总，失败为null',true),...rows('AiTokenUsageSummaryRespVO','summary'),f('trend','array','日期趋势；失败或显式跳过为null',true),...rows('AiTokenUsageTrendRespVO','trend[]'),f('modelRatio','array','模型用量分组，失败或显式跳过为null',true),...rows('AiTokenUsageGroupRespVO','modelRatio[]'),f('moduleRanking','array','技能/功能模块用量分组，失败或跳过为null',true),...rows('AiTokenUsageGroupRespVO','moduleRanking[]'),f('errors','Record<string,string>','失败项名→原错误；summary/trend/modelRatio/moduleRanking')],empty:'成功数组可为空；null可能是请求失败或直接SDK显式跳过，应结合errors与options解释。'},consume:['先检查errors，只用成功部分分析；汇总totalTokens与分组为不同视角，不能重复加总。','mostConsumedModelRate已是百分比；组对象未提供占比时按同筛选的分组consumedQuota/汇总totalConsumedQuota计算，分母0时不计算。'],steps:[next('platform-usage-usage-list','需定位异常明细时保持相同筛选分页读取')],completion:'成功图表与失败项均已报告，时间/周期/范围已明确。'})
contracts['platform-usage-function-module-list']=make('platform-usage-function-module-list',{purpose:'取得调用明细的技能/功能模块名称候选。',whenToUse:'填写平台用量functionModule筛选。',boundaries:['当前后端返回字符串数组，含内置智能助手及已发布技能名；不是技能ID清单。','keyword只本地过滤，不减少全量候选请求。'],output:{shape:'string[]',fields:[f('[]','string','技能/功能模块名称，原样传functionModule')],empty:'[]表示无候选或关键字无匹配。'},consume:['直接展示名称并原样作为筛选值；不能将数组索引当技能ID。'],steps:[next('platform-usage-usage-list','按选中技能查调用明细',{functionModule:'result.[]'})],completion:'已选定真实功能模块名称或报告无匹配。'})
const chartFields=(root:string,label:string)=>[f(root,'object',label+'，失败null',true),f(`${root}.x[]`,'string | number','横轴：时段或工具类型名称'),f(`${root}.y[]`,'number','与x同下标对应的次数，不能独立排序x/y')]
contracts['data-analysis-overview']=make('data-analysis-overview',{purpose:'取得智能交互成功率、时段提问、知识文档调用、工具调用/点击及提问热词六组分析。',whenToUse:'分析智能交互质量与热点；Token配额/计费分析使用platform-usage。',boundaries:['并发各自settle，失败项null且errors有原因；不同于页面顺序await搜索。','rightRate/wrongRate是0–1比例，展示百分比需乘100；不要套用平台用量已为百分比的usageRate。'],output:{shape:'{ answerRightRate, statsByTime, knowledgeRecordRank, aiToolRecordRank, aiToolClickRank, questionKeywordHeat, errors }',fields:[f('answerRightRate','object','回答正确率统计；失败null',true),...Object.entries({total:'总回答次数',right:'成功回答次数',wrong:'失败回答次数',rightRate:'成功比例0–1，展示百分比乘100',wrongRate:'失败比例0–1，展示百分比乘100'}).map(([k,v])=>f('answerRightRate.'+k,'number',v)),...chartFields('statsByTime','各时段问题次数'),...chartFields('aiToolRecordRank','工具调用次数排行'),...chartFields('aiToolClickRank','工具点击次数排行'),f('knowledgeRecordRank','array','知识文档调用排行，失败null',true),...Object.entries({id:'知识文件ID',type:'类型1文件/2在线文档',name:'文档名称',parentId:'父目录ID',isDel:'删除标记',createTime:'创建时间GMT+8 yyyy-MM-dd HH:mm:ss',updateTime:'更新时间GMT+8',auditStatus:'1审核通过/2待审核',auditorId:'审核人ID',isAllManager:'是否所有用户可见标志',linkId:'空间关联ID',buttonName:'文档按钮名称',callCount:'调用次数',lastCallTime:'最近调用时间GMT+8'}).map(([k,v])=>({...f('knowledgeRecordRank[].'+k,['name','createTime','updateTime','buttonName','lastCallTime'].includes(k)?'string':'number | string',v),optional:true,nullable:true})),f('questionKeywordHeat','array','热词统计，失败null',true),f('questionKeywordHeat[].keyword','string','提问关键词'),f('questionKeywordHeat[].heat','number','出现次数'),f('questionKeywordHeat[].fontSize','number','词云字体大小，仅展示用'),f('questionKeywordHeat[].color','string','词云颜色，仅展示用'),f('errors','Record<string,string>','失败的六项名称映射原始错误')],empty:'成功数组为空是无数据；null为失败，结合errors而非替换成0。'},consume:['图的x/y按下标配对；热词heat是出现次数；知识文档按callCount展示，不能把工具点击当调用。','只比较相同startTime/endTime区间；缺失图明确报告，不给不完整总量结论。'],steps:done('交付六组统计可得项及失败项，说明日期范围；不由热点推断个人身份或权限。'),completion:'统计内容、单位与缺失项已清楚展示。'})
// Structured inputs and conditional requirements cannot be represented by legacy ParamKind alone.
contracts['ai-model-save']!.inputs.testResult={...contracts['ai-model-save']!.inputs.testResult!,type:'{ status: number; supportedFiles?: string }'}
contracts['ai-model-save']!.inputs.apiKey={...contracts['ai-model-save']!.inputs.apiKey!,required:false,requiredWhen:'无id新建时必填；修改保留旧密钥时不发送'}
contracts['ai-model-save']!.inputs.dropApiKey={...contracts['ai-model-save']!.inputs.dropApiKey!,type:'boolean',required:false,default:'false'}
contracts['ai-model-selection-list']!.inputs.callTypeList={...contracts['ai-model-selection-list']!.inputs.callTypeList!,type:'number[] | string',format:'数字数组或英文逗号串；空数组不筛选调用类型'}
contracts['ai-model-selection-save']!.inputs.details={...contracts['ai-model-selection-save']!.inputs.details!,type:'Array<{code:string;modelId:number|string;isDefault:0|1}>'}
contracts['ai-model-selection-save']!.inputs.skillIds={...contracts['ai-model-selection-save']!.inputs.skillIds!,type:'string | number[]',requiredWhen:'callType=2 Web对话时后端要求非空',lookup:{capabilityId:'ai-prompt-skill-list',args:{name:'<用户关键字>',isPublish:1},valueField:'list[].id',labelField:'list[].name'}}
contracts['ai-model-apply-handle']!.inputs.status={...contracts['ai-model-apply-handle']!.inputs.status!,constraints:['仅0=待处理、3=已驳回、4=已处理；旧前端1/2在本地拒绝，不发请求']}
for(const id of ['ai-model-apply-handle','ai-model-apply-record-list']) {
 contracts[id]!.inputs.status={...contracts[id]!.inputs.status!,options:[{value:0,label:'待处理'},{value:3,label:'已驳回'},{value:4,label:'已处理'}],constraints:['兼容适配器仅允许数字0/3/4；旧值1/2本地拒绝，不自动映射；省略列表status表示不筛选']}
}
contracts['ai-model-apply-record-list']!.inputs.status={...contracts['ai-model-apply-record-list']!.inputs.status!,source:'Portal平台字典ai_token_quota_apply_status；base-dict-get.entries[].value转为数字，当前Java仅接收0/3/4',lookup:{capabilityId:'base-dict-get',args:{dictType:'ai_token_quota_apply_status'},valueField:'entries[].value',labelField:'entries[].label'}}
contracts['ai-model-apply-record-list']!.steps.push({role:'optional',when:'需要申请状态筛选标签，或某行statusName为空而需按页面规则展示',capabilityId:'base-dict-get',mapping:{dictType:'literal:"ai_token_quota_apply_status"'},instruction:'以entries[].value对应申请status并取同项label；筛选时将value转数字且仅接受当前Java的0/3/4。字典无匹配时展示按页面兼容标签后回退“-”，不能猜状态或擅自提交1/2。'})
for(const id of ['ai-model-quota-rule-save','ai-model-flow-rule-save']) {
 for(const [key,condition]of Object.entries({memberLevel:'ruleScope=1',targetTenantId:'ruleScope=2',targetUserPhone:'ruleScope=3'})) contracts[id]!.inputs[key]={...contracts[id]!.inputs[key]!,requiredWhen:condition+'，必须选择真实目标以使规则落到预期对象'}
 contracts[id]!.inputs.targetUserPhone={...contracts[id]!.inputs.targetUserPhone!,type:'string',lookup:{capabilityId:'ai-model-search-user',args:{keyword:'<用户姓名关键字>'},valueField:'list[].phone',labelField:'list[].userName'}}
}

const methodContracts:Record<string,AiContract>={}
const clone = (source:AiContract, overrides:Partial<AiContract>):AiContract => ({...source,...overrides})
function preparation(saveId:string, entitySchema:string, hasWarnings:boolean):AiContract {
 const save=contracts[saveId]!
 return clone(save,{purpose:'只读准备：校验草稿、构建请求体，修改时读取并保留旧行。',whenToUse:'真实保存之前核对将要写入内容并保存恢复快照。',effect:'prepare',boundaries:['新建只在本地装配；修改会GET当前行；均不执行保存。','直接方法第一个参数是由inputs这些字段组成的draft对象。返回payload是预览，save仍接受原始draft，不接受prepare结果对象。'],output:{shape:`{ mode: 'create'|'update', payload, current${hasWarnings?', warnings':''} }`,fields:[{...f('mode','string','无ID新建，有ID修改'),values:{create:'新建',update:'修改'}},f('payload','object','按当前draft生成的待写请求体，字段与保存输入契约一致'),...Object.entries(save.inputs).filter(([key])=>!key.includes('.')).map(([key,param])=>({...f('payload.'+key, key==='details'?'array':key.endsWith('Enabled')?'boolean':['id','modelId','targetTenantId'].includes(key)?'number | string':['temperature','timeout','maxToken','ruleScope','memberLevel','totalQuota','carryOverRule','resetCycle','shortageStrategy','tokenLimitPerMinute','maxTokenPerRequest','exceedStrategy','callType'].includes(key)?'number':'string',param.meaning),optional:true})),f('current','object','修改前当前行；新建为null',true),...rows(entitySchema,'current'),...(hasWarnings?[f('warnings[]','string','已知兼容性/不可逆风险，应逐条处理')]:[])],empty:'新建current=null是正常；修改详情缺失应停止写入而非当作新建。'},consume:['保存current作为撤销快照；payload可能含密钥，不向用户完整展示。','返回prepare并不代表保存成功或后端接受这些参数。'],steps:[next(saveId,'用户明确目标且已核对草稿时传原draft真实保存',undefined,'required')],completion:'草稿与旧值已准备，真实业务尚未写入。',failures:networkErrors,idempotency:null,gaps:[]})
}
methodContracts['aiModel.prepareSaveModel']=preparation('ai-model-save','AiModelConfigDTO',true)
methodContracts['aiModel.prepareSaveModel']!.output.fields=methodContracts['aiModel.prepareSaveModel']!.output.fields.filter(f=>!['payload.testResult','payload.dropApiKey'].includes(f.path))
methodContracts['aiModel.prepareSaveModel']!.output.fields.push(f('payload.availableStatus','number','仅testResult.status truthy时存在'),f('payload.supportedFiles','string','仅测试结果有效时追加的支持文件类型'))
methodContracts['aiModel.cancelCreatedModel']=clone(contracts['ai-model-delete']!,{purpose:'按本次创建的模型名回查唯一候选后永久删除，撤销新增模型。',whenToUse:'确认要清理本次创建且名字没有歧义的模型。',inputs:{modelName:p('本次创建时的精确模型名','ai-model-save输入modelName')},boundaries:['只扫描名称筛选的第一页20条并精确匹配；0条或多条拒绝，不猜ID。','名称非全局唯一；有更多页时不能凭第一页唯一就假定全局唯一，应先独立检查全部候选。','被选择引用的模型会被后端拒绝删除；此方法不删除引用。'],steps:[next('ai-model-list','执行前后按同名搜索核实本次对象，无法唯一识别就停止',{modelName:'args.modelName'},'required')],completion:'本次创建模型已独立确认不存在；不能确认唯一性时报告阻塞。'})
methodContracts['aiModel.restoreModel']=clone(contracts['ai-model-save']!,{purpose:'将之前读取的模型配置再写回，实现部分字段恢复。',whenToUse:'撤销本次模型配置修改，并持有prepare.current旧快照。',inputs:{previous:p('带id的旧模型行','aiModel.prepareSaveModel.current或修改前detail'),options:p('可选{apiKey}；只有显式提供旧明文才会恢复API密钥','接入方明确持有并授权恢复的旧密钥','{apiKey?:string}')},boundaries:['真实POST更新；不自动读取previous.apiKey，而只用options.apiKey，缺失则dropApiKey=true保留当前密钥。','buildModelSavePayload只恢复modelName/description/apiUrl/temperature/timeout/maxToken等选取字段；不恢复availableStatus/supportedFiles等测试元数据，也非整行回滚。'],consume:['回查已恢复字段；明确报告API密钥及测试元数据是否未恢复，不能宣称完整撤销。'],steps:[next('ai-model-detail','写回后按previous.id核实恢复字段',{id:'args.previous.id'},'required')],completion:'可恢复字段已核实；未恢复字段已逐项报告。'})
methodContracts['aiModel.testModelConnectivityFromForm']=clone(contracts['ai-model-test']!,{purpose:'按编辑表单字段顺序调用同一个模型连通性测试。',whenToUse:'直接SDK从未保存表单测试连接时。',inputs:{form:p('modelName/apiUrl必填；apiKey可选、id可选','用户当前编辑草稿','{id?,modelName,apiUrl,apiKey?}')},boundaries:['与列表测试效果相同：探测上游但不保存模型；请求id排在最后。'],steps:contracts['ai-model-test']!.steps})
for(const [kind,schema,prefix]of [['quota','AiTokenQuotaRuleRespVO','Quota'],['flow','AiTokenFlowRuleRespVO','Flow']] as const){
 methodContracts[`aiModel.prepareSave${prefix}Rule`]=preparation(`ai-model-${kind}-rule-save`,schema,false)
 methodContracts[`aiModel.get${prefix}Rule`]=clone(contracts[`ai-model-${kind}-rule-list`]!,{purpose:`按规则ID取得完整${kind==='quota'?'额度':'流速'}规则与派生用量。`,whenToUse:'修改前读取旧行、写后核实或读取命中规则详情。',inputs:{id:p('规则ID',`ai-model-${kind}-rule-list.list[].id或save新建返回值`)},output:detail(schema),steps:[method(`aiModel.prepareSave${prefix}Rule`,'需修改时基于完整规则构建草稿')],completion:'完整规则已交付；不存在则明确报告。'})
 methodContracts[`aiModel.cancelCreated${prefix}Rule`]=clone(contracts[`ai-model-${kind}-rule-delete`]!,{purpose:`按新建返回ID永久删除本次${kind==='quota'?'额度':'流速'}规则，撤销新增。`,whenToUse:'撤销本次新建规则且持有其返回ID。'})
 methodContracts[`aiModel.restore${prefix}Rule`]=clone(contracts[`ai-model-${kind}-rule-save`]!,{purpose:`将修改前${kind==='quota'?'额度':'流速'}规则快照再写回。`,whenToUse:'撤销本次修改且持有prepare.current。',inputs:{previous:p('带id的修改前规则对象',`aiModel.prepareSave${prefix}Rule.current`)},output:boolReceipt,boundaries:['真实更新；只经保存payload选取支持的配置字段，不恢复服务端派生额度/使用计数或审计时间。','会再产生一条调整历史；不是抹掉原操作。'],steps:[method(`aiModel.get${prefix}Rule`,'恢复后按previous.id核实配置字段','required',{id:'args.previous.id'})],completion:'支持恢复的配置字段已核实，派生字段与历史仍按服务器当前状态。'})
}
methodContracts['aiModel.prepareHandleApply']=clone(contracts['ai-model-apply-handle']!,{purpose:'本地装配申请处理请求，并保留调用方提供的旧状态。',whenToUse:'处理申请前留存previousStatus。',effect:'prepare',inputs:{apply:p('申请对象，id必填、status用于恢复','ai-model-apply-record-list.list[]'),status:p('目标状态，只允许数字0待处理/3已驳回/4已处理','用户明确业务意图；旧1/2本地拒绝','number'),options:p('可选驳回原因','用户提供','{rejectReason?:string}')},output:{shape:'{ payload: {id,status,statisticsDimension,rejectReason?}, previousStatus }',fields:[f('payload.id','number | string','输入申请ID'),f('payload.status','number','准备写入状态'),f('payload.statisticsDimension','number','固定3平台'),{...f('payload.rejectReason','string','驳回原因，按输入保留'),optional:true},{...f('previousStatus','number','调用方apply.status，没有主动向后端取最新状态'),optional:true}],empty:'previousStatus可缺失；这意味着没有可恢复的旧状态，不能伪造0。'},boundaries:['纯本地，不发网络；apply.status可能陈旧，不代表服务器当前状态。',applyVerificationLimit],consume:['保留previousStatus供撤销；写前按最新申请列表确认，避免覆盖他人已处理状态。'],steps:[next('ai-model-apply-handle','确认目标状态0/3/4后再真实处理',undefined,'required')],completion:'请求草稿已形成，未写入；页面“忽略”仍被当前协议冲突阻塞。',idempotency:null,gaps:[applyIgnoreGap]})
methodContracts['aiModel.cancelHandledApply']=clone(contracts['ai-model-apply-handle']!,{purpose:'将申请状态写回之前记录的previousStatus。',whenToUse:'撤销本次申请状态变更；只恢复状态，不撤销配套规则。',inputs:{applyId:p('申请ID','原申请list[].id'),previousStatus:p('之前读到的状态，只支持0/3/4；0是合法待处理值，旧1/2拒绝','aiModel.prepareHandleApply.previousStatus','number')},boundaries:['真实写入；只改申请状态，不删除一键填写创建的规则。','不会完整恢复驳回原因/处理时间/处理人等历史字段，不能宣称整条申请回滚。'],steps:[next('ai-model-apply-record-list','回查同申请ID核实旧状态已恢复',undefined,'required')],completion:'状态恢复已独立核实，关联规则需要另外清理。',gaps:[]})
for(const [kind,prefix]of [['quota','Quota'],['flow','Flow']] as const){
 methodContracts[`aiModel.fillApplyWith${prefix}Rule`]=clone(contracts[`ai-model-${kind}-rule-save`]!,{
  purpose:`把提升申请期望值创建为${kind==='quota'?'额度':'流速'}规则，再把申请标成4已处理。`,
  whenToUse:'用户明确要求配置申请规则，并已确认目标手机号或租户；需要恢复部分失败时不要重跑本方法。',
  inputs:{
   input:p('申请、可选规则表单以及skipApplyStatus','申请来自ai-model-apply-record-list.list[]','{apply,form?,skipApplyStatus?}'),
   'input.apply.id':p('申请ID','list[].id'),
   'input.apply.modelId':p('模型ID','list[].modelId'),
   'input.apply.status':p('修改前状态，仅作恢复快照不主动刷新；允许原始旧1/2但不能直接恢复为这些值；缺失不默认0','list[].status'),
   'input.apply.tenantId':p('非零正整数为租户规则；缺失/null/0/字符串0为个人规则','申请所属企业ID；保持页面租户与个人分支'),
   'input.apply.userId':p('申请用户ID，仅用于显示/消歧；不作为规则命中键，不发送targetUserId','申请list[].userId'),
   'input.apply.userPhone':p('个人申请的目标手机号；优先采用此字段，保留字符串','申请list[].userPhone'),
   'input.form.targetUserPhone':{...p('申请无userPhone时必填；与已有userPhone冲突则写前拒绝','ai-model-search-user候选phone，必须人工确认申请人；不按同名自动选择','string'),lookup:{capabilityId:'ai-model-search-user',args:{keyword:'用户提供的申请人姓名或手机号'},valueField:'list[].phone',labelField:'list[].userName'}},
   'input.form.targetUserName':p('可选目标姓名，缺省申请userName；仅展示','选定候选userName'),
   'input.form.targetUserTypeName':p('可选用户来源类型','同一候选tradeStr'),
   'input.form':p(kind==='quota'?'totalQuota优先于expectedMonthlyQuota；resetCycle(0/1/2/3)、shortageStrategy(1/2)、startTime必填':'maxTokenPerRequest优先于expectedMaxToken；tokenLimitPerMinute、exceedStrategy(1/2/3)、startTime必填','用户明确的规则配置；Token值必须安全正整数（字符串仅十进制整数形式）；totalQuota/tokenLimitPerMinute≤9007199254740991，maxTokenPerRequest≤2147483647；startTime使用YYYY-MM-DD HH:mm:ss','对象；不消费id，始终创建新规则'),
   'input.skipApplyStatus':p('true只创建规则；false/省略在创建后写status=4已处理','用户明确选择','boolean'),
  },
  output:{shape:'{ createdRuleId, applyHandled, warnings: string[] }',fields:[f('createdRuleId','number | string','第一步新建规则ID，保存供回读/删除'),f('applyHandled','boolean | null','第二步申请处理回执；skipApplyStatus=true为null，不代表状态已处理'),f('warnings[]','string','兼容保留的警告数组；已修复目标字段，不再用警告代替正确落点')],empty:'第二步失败或没有明确返回true时抛AiModelApplyPartialWriteError，error.createdRuleId保留已创建规则ID；首步无有效ID则报告结果不确定，停止处理申请。'},
  boundaries:['两次独立真写，非事务：save规则→handle(status=4)；不把旧2映射为4，而是将已执行的配置意图明确标为已处理。','个人规则发送targetUserPhone；额度后端将缺省targetTenantId归一0，流速后端不做该归一，SDK请求兼容层在发送前显式补targetTenantId=0。非零tenantId仍按页面语义配置整租户，不能据申请userId把它当个人规则。','skipApplyStatus只跳过第二步，不是prepare或dry-run。',applyVerificationLimit],
  consume:['成功时保存createdRuleId，分别回读规则目标与申请状态。','捕获AI_MODEL_APPLY_PARTIAL_WRITE：保留error.createdRuleId/applyId/ruleKind/previousStatus/stage/cause。先get规则和list申请；规则正确但申请未处理时仅单独handleApply({id:applyId},4)，不要重跑fill以免重复建规则。','如用户要撤销，按createdRuleId删除本次规则；申请状态只有确认已改动且原状态合法时才单独恢复。不得因网络异常自动删除已创建规则。'],
  steps:[method(`aiModel.get${prefix}Rule`,'创建后核实规则确实落到目标对象','required',{id:'result.createdRuleId'}),method(`aiModel.cancelCreated${prefix}Rule`,'用户明确撤销时删除本次新建规则','cancel',{id:'result.createdRuleId'}),method('aiModel.cancelHandledApply','申请状态已修改且持有合法旧状态时恢复','cancel')],
  failures:[...writeErrors,'个人缺手机号或手机号冲突、Token非安全正整数/超范围、缺必需规则字段：首次写入前拒绝。apply.status只是原始恢复快照，可能是旧1/2；fill不把它当目标状态校验，缺失不默认0。直接handle/prepare/cancel传目标1/2则本地拒绝。','AiModelApplyPartialWriteError为SDK本地错误类，不是后端错误码；createdRuleId是已创建规则的真实回执，第二步状态需回读确认。','首步超时/缺有效ID无法确定是否已创建；按模型和目标手机号/租户回查，不自动重试。'],
  completion:'规则目标与申请状态两者均核实；部分失败不得报告全成功。',gaps:[],
 })
 const filled=methodContracts[`aiModel.fillApplyWith${prefix}Rule`]!
 filled.inputs['input.apply.expectedMonthlyQuota']=p('额度表单未给totalQuota时采用的申请期望月额度，Token，必须是1–9007199254740991安全整数','申请list[].expectedMonthlyQuota','number | string')
 filled.inputs['input.apply.expectedMaxToken']=p('流速表单未给maxTokenPerRequest时采用的期望单次Token数，必须是1–2147483647整数','申请list[].expectedMaxToken','number | string')
 for(const name of kind==='quota'?['totalQuota','resetCycle','shortageStrategy','startTime','endTime','reason']:['tokenLimitPerMinute','maxTokenPerRequest','exceedStrategy','startTime','endTime','reason']) {
  const source=contracts[`ai-model-${kind}-rule-save`]!.inputs[name]
  if(source)filled.inputs[`input.form.${name}`]={...source,required:['startTime','resetCycle','shortageStrategy','tokenLimitPerMinute','exceedStrategy'].includes(name),source:name==='totalQuota'?'用户表单值；省略取申请expectedMonthlyQuota':name==='maxTokenPerRequest'?'用户表单值；省略取申请expectedMaxToken':'用户明确的规则配置，不从申请状态推算'}
 }

}
contracts['ai-model-flow-rule-save']!.boundaries.push('个人规则当前草稿构造器不保留targetTenantId；请求兼容层在精确flow-rule/create POST及update PUT、ruleScope=3且有非空targetUserPhone、无目标租户时补0。不能用本入口配置非零租户内的个人规则。')
methodContracts['aiModel.prepareSaveFlowRule']!.boundaries.push('prepare.payload仍是原始装配结果，个人targetTenantId可缺省；真正发送时请求兼容层补0，不能声称后端会自动补齐。')
methodContracts['aiModel.restoreFlowRule']!.boundaries.push('个人规则targetTenantId会在发送前补0；旧记录若是非零租户内个人规则，不可使用本方法恢复，需有能保留该租户字段的执行入口。')
methodContracts['aiModel.prepareSaveModelSelection']=preparation('ai-model-selection-save','AiModelSelectionDTO',true)
methodContracts['aiModel.prepareSaveModelSelection']!.output.fields.push(...rows('AiModelSelectionDetailDTO','current.details[]'))
methodContracts['aiModel.cancelCreatedModelSelection']=clone(contracts['ai-model-selection-delete']!,{purpose:'按本次创建的callType回查唯一配置后删除，撤销新增模型选择。',whenToUse:'撤销本次新增且能确认该调用类型只存在本次配置。',inputs:{callType:p('本次创建调用类型','ai-model-selection-save输入callType','1–4')},boundaries:['查第一页20条且精确匹配callType；不为1条就拒绝，不猜要删哪条。','不是恢复旧配置，不能用于撤销修改。'],steps:[next('ai-model-selection-list','执行前后按callTypeList=[callType]核实唯一性及删除结果',undefined,'required')]})
methodContracts['aiModel.restoreModelSelection']=clone(contracts['ai-model-selection-save']!,{purpose:'把旧模型选择配置折回带id草稿后重新保存。',whenToUse:'撤销本次修改，并持有prepare.current旧配置。',inputs:{previous:p('必须含id/callType；details只取code/modelId/isDefault，skillIdList转英文逗号串skillIds','aiModel.prepareSaveModelSelection.current，调用方执行明确字段转换','ModelSelectionSaveDraft')},boundaries:['真实更新而非服务器事务回滚；不能直接把details行id当modelId。','以details为准保留每个用途的默认/备选；不使用可能缺失的modelIdList猜完整配置。'],steps:[next('ai-model-selection-detail','恢复后同ID读取核实用途和技能',{id:'args.previous.id'},'required')],completion:'默认/备选模型与技能恢复值已独立核实。'})


// Nested identifiers are explicit because restore mappings consume them.
for (const path of ['aiModel.restoreModel','aiModel.restoreQuotaRule','aiModel.restoreFlowRule','aiModel.restoreModelSelection']) {
 methodContracts[path]!.inputs['previous.id']=p('要恢复的原记录主键，不生成新记录','prepare.current.id或修改前详情id','number | string')
}
methodContracts['aiModel.prepareSaveModelSelection']!.output.fields.push(
 f('payload.details[].code','string','模型用途代码，与模型选择保存details[].code一致'),
 f('payload.details[].modelId','number | string','可用候选模型ID'),
 {...f('payload.details[].isDefault','number','同用途默认或备选'),values:values.isDefault},
)

// Keep contract publication aligned with the actual registered working-tree scope.
// AI implementation files can belong to a parallel work unit; importing them here would
// break a staged-only checkout that has not registered those modules yet.
export const AI_MODEL_CONTRACTS: Record<string,AiContract> = Object.fromEntries(definitions.map(d=>{
 const value=contracts[d.id]
 if(!value) throw new Error(`Missing AI model contract: ${d.id}`)
 return [d.id,value]
}))
export const AI_MODEL_METHOD_CONTRACTS: Record<string,AiContract> = definitions.length ? methodContracts : {}
