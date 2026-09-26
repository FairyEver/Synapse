#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境读一遍**绩效管理域 + 审批管理域**（只读）。
 *
 * 运行：smoke/with-portal-token.sh node smoke/read-perf-flow.mjs
 *
 * **只做读操作。** 这两域里能写的页面很多（删协议 / 启停标准 / 导入导出 / 流程部署…），
 * 本脚本一个都不碰 —— 它们都没进能力定义（见各页文档的「尚未覆盖」）。
 */
import axios from 'axios'
import { createPortalHeadless } from '../dist/index.js'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID
if (!baseUrl || !token || !tenantId) {
  process.stderr.write('缺少 PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID\n用法：smoke/with-portal-token.sh node smoke/read-perf-flow.mjs\n')
  process.exit(1)
}
const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })
const sent = []
const inner = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (c) => { sent.push(`${String(c.method).toUpperCase()} ${String(c.url)}`); return inner(c) }

let fail = 0
const check = (ok, label, detail = '') => {
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}\n`)
  if (!ok) fail++
}
const last = () => String(sent[sent.length - 1] ?? '(没发请求)').replace(/^https?:\/\/[^/]+/, '')

/** 逐个调用；每个能力打印条数与真正发出的接口 */
async function probe (label, run, expectError) {
  try {
    const r = await run()
    const n = Array.isArray(r) ? r.length : (r?.list?.length ?? '—')
    const total = r?.total ?? '—'
    process.stdout.write(`   ${label.padEnd(30)} ${String(n).padStart(4)} 条 / 共 ${total}   ${last().slice(0, 78)}\n`)
    if (expectError) { fail++; process.stdout.write(`      ✗ 本应报「${expectError}」却成功了\n`) }
    return r
  } catch (e) {
    const msg = String(e?.message ?? '')
    if (expectError && msg.includes(expectError)) {
      process.stdout.write(`   ${label.padEnd(30)} ✓ 按预期报错：${msg.slice(0, 60)}   ${last().slice(0, 60)}\n`)
      return null
    }
    process.stdout.write(`   ${label.padEnd(30)} ✗ ${msg.slice(0, 90)}\n`)
    fail++
    return null
  }
}

process.stdout.write('① 绩效·协议类\n')
await probe('状态变更', () => sdk.perfAgreement.listAgreementChange('month', { pageNo: 1, pageSize: 3 }))
await probe('个人月度', () => sdk.perfAgreement.listMonthAgreements({ pageNo: 1, pageSize: 3 }))
await probe('所辖月度', () => sdk.perfAgreement.listMonthAgreementsOthers({ pageNo: 1, pageSize: 3 }))
await probe('个人年度', () => sdk.perfAgreement.listYearAgreements({ pageNo: 1, pageSize: 3 }))
// ⚠️ 这一页**必报**「用户查询结果超过500条」：后端在这条路径上拉全量用户建映射，
// 撞上 `HrSysUserServiceImpl` 的 `MAX_LEGACY_USER_RESULTS = 500` 兜底 ——
// 与「学习管理域」那个课程页/即时通讯课程页是**同一个根因**。实测（2026-09-21）。
await probe('所辖年度（预期报错）', () => sdk.perfAgreement.listYearAgreementsOthers({ pageNo: 1, pageSize: 3 }), '超过500条')
await probe('年度协议配置', () => sdk.perfAgreement.getYearProtocolConfig())

process.stdout.write('\n② 绩效·配置类\n')
await probe('公式配置', () => sdk.perfManageConfig.listFormulaDefinitions({ pageNo: 1, pageSize: 3 }))
await probe('指标管理', () => sdk.perfManageConfig.listIndicators({}))
await probe('五险一金', () => sdk.perfManageConfig.listInsuranceFunds({ pageNo: 1, pageSize: 3 }))
await probe('标准管理', () => sdk.perfManageConfig.listStandards({ pageNo: 1, pageSize: 3 }))
await probe('时间节点', () => sdk.perfManageConfig.readProtocolConfig())
// ⚠️ 这一页必报 403：后端三条 GET 都带 `@PreAuthorize('hr:performance-config:manage')`，
// 而**菜单可见性判不出权限码**（conventions 第 15 条）。实测（2026-09-21）。
await probe('考核规则（预期 403）', () => sdk.perfManageConfig.listProtocolDeductRules(), '权限')

process.stdout.write('\n③ 绩效·模板/任务类\n')
await probe('利润管理', () => sdk.perfManageTemplate.listProfits({}))
await probe('薪资结构', () => sdk.perfManageTemplate.listSalaryStructures({ pageSize: 3 }))
await probe('模板内容', () => sdk.perfManageTemplate.listTemplateContents({}))
await probe('模板结构', () => sdk.perfManageTemplate.listTemplateStructures({}))
await probe('学习任务配置', () => sdk.perfManageTemplate.getStudyTaskConfig())
await probe('任务类型配置', () => sdk.perfManageTemplate.listTaskTypeConfigs())

process.stdout.write('\n④ 绩效·薪酬与分析\n')
await probe('奖励导入', () => sdk.perfSalary.listSalaryMain({ pageNo: 1, pageSize: 3 }))
await probe('工资找齐', () => sdk.perfSalary.listSalaryAdjust({ pageNo: 1, pageSize: 3 }))
await probe('考核导入', () => sdk.perfSalary.listSalaryExamineResult({ pageNo: 1, pageSize: 3 }))
await probe('组件管理', () => sdk.perfSalary.listBlockMain({ pageNo: 1, pageSize: 3 }))
await probe('管理分析', () => sdk.perfSalary.getAnalysisDepartmentSummary())
await probe('个人分析', () => sdk.perfSalary.getAnalysisPersonSummary())

process.stdout.write('\n⑤ 审批管理·任务\n')
await probe('发起流程', () => sdk.flowTask.listDefinitions())
await probe('待办任务', () => sdk.flowTask.listTodo({ pageNo: 1, pageSize: 3 }))
await probe('已办任务', () => sdk.flowTask.listDone({ pageNo: 1, pageSize: 3 }))
await probe('抄送我的', () => sdk.flowTask.listCopy({ pageNo: 1, pageSize: 3 }))

process.stdout.write('\n⑥ 审批管理·流程管理\n')
await probe('流程模型', () => sdk.flowManage.listModels({ pageNo: 1, limit: 3 }))
await probe('AI审核配置', () => sdk.flowManage.listAiReviewConfigs({ pageNo: 1, pageSize: 3 }))
await probe('流程实例', () => sdk.flowManage.listProcessInstances({ pageNo: 1, pageSize: 3 }))
await probe('流程任务', () => sdk.flowManage.listFlowTasks({ pageNo: 1, pageSize: 3 }))

process.stdout.write(`\n${fail === 0 ? '✅ 全部符合预期' : `❌ ${fail} 项不符合预期`}\n`)
process.exit(fail === 0 ? 0 : 1)
