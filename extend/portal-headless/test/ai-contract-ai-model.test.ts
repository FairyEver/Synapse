import { describe, expect, it } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createPortalHeadless } from '../src/index.js'
import { AI_MODEL_CONTRACTS, AI_MODEL_METHOD_CONTRACTS } from '../src/catalog/contracts-ai-model.js'

const ids=ALL_CAPABILITY_DEFINITIONS.filter(d=>d.id.startsWith('ai-model-')||d.id.startsWith('platform-usage-')||d.id==='data-analysis-overview').map(d=>d.id)
const catalog=createCatalog({capabilities:ALL_CAPABILITY_DEFINITIONS})
function contract(id:string){const d=catalog.describe(id);if(!d.ok||!d.ai)throw Error('Missing actual AI description '+id);return d.ai}
function method(path:string){const d=catalog.describeMethod(path);if(!d.ok)throw Error('Missing method '+path);return d.ai}
const field=(id:string,path:string)=>{const f=contract(id).output.fields.find(f=>f.path===path);if(!f)throw Error(`Missing field ${id}.${path}`);return f}
// AI modules can be in another parallel working unit and are absent from staged-only HEAD.
describe.skipIf(ids.length===0)('AI模型4页实际描述契约',()=>{
 it('28注册与19公开辅助方法均覆盖，步骤不指向不存在能力',()=>{
  expect(ids).toHaveLength(28)
  expect(Object.keys(AI_MODEL_CONTRACTS).sort()).toEqual([...ids].sort())
  expect(Object.keys(AI_MODEL_METHOD_CONTRACTS)).toHaveLength(19)
  for(const id of ids){const c=contract(id);for(const step of c.steps){if(step.capabilityId){const d=catalog.describe(step.capabilityId);expect(d.ok).toBe(true);if(d.ok)expect(d.invoke).not.toBeNull()}if(step.sdkPath)expect(catalog.describeMethod(step.sdkPath).ok).toBe(true)}}
  for(const path of Object.keys(AI_MODEL_METHOD_CONTRACTS))expect(method(path)).toEqual(AI_MODEL_METHOD_CONTRACTS[path])
 })
 it('模型写回执null与规则新增ID/修改boolean区分，准备仅只读',()=>{
  expect(contract('ai-model-save').effect).toBe('write')
  expect(contract('ai-model-save').output.shape).toBe('null')
  expect(method('aiModel.prepareSaveModel').effect).toBe('prepare')
  expect(method('aiModel.prepareSaveModel').output.fields.find(f=>f.path==='current')?.nullable).toBe(true)
  expect(contract('ai-model-quota-rule-save').output.shape).toContain('新建ID')
  expect(contract('ai-model-quota-rule-save').output.shape).toContain('修改结果')
  expect(contract('ai-model-save').inputs.dropApiKey?.meaning).toContain('不发送')
  expect(field('ai-model-detail','availableStatus').values).toEqual({'0':'未测试','1':'正常','2':'异常'})
 })
 it('最新后端可能返回明文，restore不自动恢复previous.apiKey或测试元数据',()=>{
  expect(contract('ai-model-detail').boundaries.join(' ')).toContain('未清apiKey/authToken')
  expect(method('aiModel.restoreModel').boundaries.join(' ')).toContain('只用options.apiKey')
  expect(method('aiModel.restoreModel').boundaries.join(' ')).toContain('不恢复availableStatus/supportedFiles')
 })
 it('个人规则真实候选键是phone/userName/tradeStr，技能与模型不混用',()=>{
  expect(contract('ai-model-search-user').steps[0]?.mapping).toEqual({targetUserPhone:'result.list[].phone',targetUserName:'result.list[].userName',targetUserTypeName:'result.list[].tradeStr'})
  expect(contract('ai-model-selection-save').inputs.skillIds?.source).toContain('ai-prompt-skill-list')
  expect(contract('ai-model-selection-save').inputs.skillIds?.source).toContain('isPublish:1')
  expect(contract('ai-model-selection-save').inputs['details[].modelId']?.source).toBe('ai-model-available-list[].id')
 })
 it('申请只接受0/3/4、handle非增加额度、两步写部分失败保留真实规则ID',()=>{
  expect(field('ai-model-apply-record-list','list[].status').values).toEqual({'0':'待处理','3':'已驳回','4':'已处理'})
  expect(contract('ai-model-apply-handle').purpose).toContain('不创建额度')
  const described=catalog.describe('ai-model-apply-handle');if(described.ok)expect(described.params.find(p=>p.name==='status')?.options).toEqual([{value:0,label:'待处理'},{value:3,label:'已驳回'},{value:4,label:'已处理'}])
  expect(contract('ai-model-apply-handle').boundaries.join(' ')).toContain('旧1忽略/2填写写前拒绝')
  expect(contract('ai-model-apply-handle').gaps?.join(' ')).toContain('Portal申请记录的待处理行可见“忽略”按钮')
  expect(contract('ai-model-apply-handle').gaps?.join(' ')).toContain('@Valid/@InEnum仅接受0/3/4')
  expect(contract('ai-model-apply-handle').whenToUse).toContain('不能据此宣称页面有任意状态编辑功能')
  expect(contract('ai-model-apply-pending-count').inputs.statisticsDimension?.meaning).toContain('固定3')
  expect(method('aiModel.fillApplyWithQuotaRule').output.empty).toContain('error.createdRuleId')
  expect(method('aiModel.fillApplyWithQuotaRule').inputs['input.form.targetUserPhone']?.lookup).toMatchObject({capabilityId:'ai-model-search-user',valueField:'list[].phone'})
  expect(method('aiModel.fillApplyWithQuotaRule').consume.join(' ')).toContain('不要重跑fill')
  expect(method('aiModel.fillApplyWithQuotaRule').boundaries.join(' ')).toContain('未在部署环境重放真实申请写入')
  expect(method('aiModel.cancelHandledApply').boundaries.join(' ')).toContain('不删除一键填写创建的规则')
 })
 it('申请状态遵循页面展示顺序，并区分可见忽略与当前协议冲突',()=>{
  const list=contract('ai-model-apply-record-list')
  expect(list.consume.join(' ')).toContain('状态显示优先statusName，再平台字典ai_token_quota_apply_status的标签')
  expect(list.consume.join(' ')).toContain('0待处理/1已忽略/2已填写/3已驳回')
  expect(list.consume.join(' ')).toContain('仅status===0的行显示一键填写和忽略')
  expect(list.boundaries.join(' ')).toContain('Java分页VO也校验status仅0/3/4')
  expect(field('ai-model-apply-record-list','list[].statusName').meaning).toContain('空字符串/null/缺失')
  expect(field('ai-model-apply-record-list','list[].status').constraints?.join(' ')).toContain('显示旧1/2不代表写入允许1/2')
  expect(method('aiModel.prepareHandleApply').gaps?.join(' ')).toContain('固定发送status=1')
  expect(method('aiModel.cancelHandledApply').gaps).toEqual([])
  expect(list.inputs.status?.lookup).toEqual({capabilityId:'base-dict-get',args:{dictType:'ai_token_quota_apply_status'},valueField:'entries[].value',labelField:'entries[].label'})
  expect(list.steps.find(step=>step.capabilityId==='base-dict-get')?.mapping).toEqual({dictType:'literal:"ai_token_quota_apply_status"'})
  expect(contract('ai-model-apply-handle').completion).toContain('不能声称已完成页面“忽略”动作')
 })
 it('平台用量明细毫秒/展示秒与成功率0–1/用量百分比单位明确',()=>{
  expect(field('platform-usage-usage-detail','durationMs').meaning).toContain('毫秒')
  expect(field('platform-usage-usage-detail','durationMsStr').meaning).toContain('秒')
  expect(field('platform-usage-quota-list','list[].usageRate').meaning).toContain('百分比')
  expect(field('data-analysis-overview','answerRightRate.rightRate').meaning).toContain('0–1')
  expect(contract('platform-usage-usage-list').inputs.quotaCycle?.meaning).toContain('默认2周')
  expect(contract('platform-usage-quota-list').boundaries.join(' ')).toContain('默认3月')
  expect(contract('platform-usage-function-module-list').output.shape).toBe('string[]')
  expect(field('data-analysis-overview','aiToolRecordRank.x[]').meaning).toContain('横轴')
 })
 it('实际门面以脱敏夹具读写：模型save返回null，rule新增ID与修改true，prepare不POST',async()=>{
  const sdk=createPortalHeadless({baseUrl:'https://example.invalid',credential:{token:'fixture',tenantId:1}}) as unknown as {http:{defaults:{adapter: (request: {url?:string;method?:string;data?:string})=>Promise<object>}};aiModel:Record<string,(...args:any[])=>Promise<any>>}
  const calls:Array<{url?:string;method?:string;data?:string}>=[]
  sdk.http.defaults.adapter=async req=>{calls.push(req);let data:unknown=null;if(req.url?.includes('/quota-rule/create'))data=456;if(req.url?.includes('/quota-rule/update')||req.url?.includes('/apply/handle'))data=true;if(req.method==='get')data={id:7,modelName:'测试模型',description:'旧值',apiUrl:'https://example.invalid/chat/completions'};return {data:{ret:'SUCCESS',data},status:200,statusText:'OK',headers:{},config:req}}
  const model={modelName:'测试模型',description:'配置',apiUrl:'https://example.invalid/chat/completions',apiKey:'test-only'}
  const prepared=await sdk.aiModel.prepareSaveModel!(model)
  expect(prepared.mode).toBe('create');expect(calls).toHaveLength(0)
  expect(await sdk.aiModel.saveModel!(model)).toBeNull()
  const rule={modelId:7,ruleScope:1,memberLevel:1,totalQuota:100,resetCycle:3,shortageStrategy:1,startTime:'2026-09-22 00:00:00'}
  expect(await sdk.aiModel.saveQuotaRule!(rule)).toBe(456)
  expect(await sdk.aiModel.saveQuotaRule!({...rule,id:456})).toBe(true)
  expect(contract('ai-model-quota-rule-save').output.fields[0]?.meaning).toContain('带id修改返回成功布尔值')
  expect(await sdk.aiModel.handleApply!({id:789},4)).toBe(true)
  expect(JSON.parse(calls.find(c=>c.url?.includes('/apply/handle'))!.data!)).toMatchObject({id:789,status:4,statisticsDimension:3})
 })

 it('门面与invoke均安装兼容协议，个人fill发送phone且部分写失败可恢复',async()=>{
  const sdk=createPortalHeadless({baseUrl:'https://example.invalid',credential:{token:'fixture',tenantId:1}}) as unknown as {http:{defaults:{adapter:(request:{url?:string;method?:string;data?:string})=>Promise<object>}};aiModel:Record<string,(...args:any[])=>Promise<any>>;capabilities:{invoke:(id:string,args:Record<string,unknown>)=>Promise<unknown>}}
  const calls:Array<{url?:string;method?:string;data?:string}>=[]
  sdk.http.defaults.adapter=async req=>{
   calls.push(req)
   if(req.url?.includes('/apply/handle'))throw Error('fixture timeout after sending')
   return {data:{ret:'SUCCESS',data:715},status:200,statusText:'OK',headers:{},config:req}
  }
  await expect(sdk.aiModel.handleApply!({id:88},2)).rejects.toThrow('没有可靠映射')
  await expect(sdk.capabilities.invoke('ai-model-apply-handle',{id:88,status:1})).rejects.toThrow('没有可靠映射')
  expect(calls).toHaveLength(0)
  await expect(sdk.aiModel.fillApplyWithQuotaRule!({apply:{id:88,modelId:7,status:0,userPhone:'13800138000',expectedMonthlyQuota:2000},form:{resetCycle:3,shortageStrategy:1,startTime:'2026-09-22 00:00:00'}})).rejects.toMatchObject({code:'AI_MODEL_APPLY_PARTIAL_WRITE',createdRuleId:715,applyId:88,previousStatus:0,ruleKind:'quota'})
  expect(calls).toHaveLength(2)
  const body=JSON.parse(calls[0]!.data!)
  expect(body).toMatchObject({ruleScope:3,targetUserPhone:'13800138000',totalQuota:2000})
  expect(body).not.toHaveProperty('targetUserId')
  expect(JSON.parse(calls[1]!.data!)).toMatchObject({id:88,status:4,statisticsDimension:3})
  expect(method('aiModel.fillApplyWithQuotaRule').output.fields.find(f=>f.path==='createdRuleId')?.meaning).toContain('回读/删除')
 })

 it('个人流速创建/修改经公共请求层补0，满足Java目标租户必填校验',async()=>{
  const sdk=createPortalHeadless({baseUrl:'https://example.invalid',credential:{token:'fixture',tenantId:1}}) as unknown as {http:{defaults:{adapter:(request:{url?:string;method?:string;data?:string})=>Promise<object>}};aiModel:Record<string,(...args:any[])=>Promise<any>>}
  const writes:Array<Record<string,unknown>>=[]
  sdk.http.defaults.adapter=async req=>{
   const body=JSON.parse(req.data??'{}')
   if(req.url?.includes('/flow-rule/')){
    // Match Java validateRuleTarget: scope3 requires both tenant and phone; no Java default here.
    if(body.ruleScope===3&&(body.targetTenantId==null||!body.targetUserPhone))throw Error('个人规则必须选择租户和用户手机号')
    writes.push(body)
   }
   return {data:{ret:'SUCCESS',data:req.url?.endsWith('/flow-rule/create')?716:true},status:200,statusText:'OK',headers:{},config:req}
  }
  const result=await sdk.aiModel.fillApplyWithFlowRule!({apply:{id:88,modelId:7,status:0,userPhone:'13800138000',expectedMaxToken:2000},form:{tokenLimitPerMinute:6000,exceedStrategy:1,startTime:'2026-09-22 00:00:00'}})
  expect(result).toMatchObject({createdRuleId:716,applyHandled:true})
  await sdk.aiModel.saveFlowRule!({id:716,modelId:7,ruleScope:3,targetUserPhone:'13800138000',maxTokenPerRequest:2000,tokenLimitPerMinute:7000,exceedStrategy:1,startTime:'2026-09-22 00:00:00'})
  expect(writes).toHaveLength(2)
  for(const body of writes){expect(body).toMatchObject({ruleScope:3,targetTenantId:0,targetUserPhone:'13800138000'});expect(body).not.toHaveProperty('targetUserId')}
  expect(method('aiModel.fillApplyWithFlowRule').boundaries.join(' ')).toContain('流速后端不做该归一')
  expect(contract('ai-model-flow-rule-save').boundaries.join(' ')).toContain('请求兼容层')
 })
 it('实际公开aiModel门面的全部未注册方法可下钻，没有静默遗漏',async()=>{
  const {CAPABILITY_BINDINGS}=await import('../src/capabilities/invoke.js')
  const sdk=createPortalHeadless({baseUrl:'https://example.invalid',credential:{token:'fixture',tenantId:1}}) as unknown as {aiModel:Record<string,unknown>}
  const bound=new Set(CAPABILITY_BINDINGS.map(b=>b.sdkPath))
  const extra=Object.entries(sdk.aiModel).filter(([name,value])=>typeof value==='function'&&!bound.has('aiModel.'+name)).map(([name])=>'aiModel.'+name)
  expect(extra.sort()).toEqual(Object.keys(AI_MODEL_METHOD_CONTRACTS).sort())
 })
 it('页面选择与同页能力用途保持一致',()=>{
  for(const d of ALL_CAPABILITY_DEFINITIONS.filter(d=>ids.includes(d.id))){const page=catalog.describePage(d.pagePath);expect(page.ok).toBe(true);if(page.ok)expect(JSON.stringify(page)).toContain(contract(d.id).purpose)}
 })
})
