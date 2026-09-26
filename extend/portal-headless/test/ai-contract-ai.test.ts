import { describe, it, expect } from 'vitest'
import { createCatalog } from '../src/catalog/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { AI_CORE_CONTRACTS } from '../src/catalog/contracts-ai-core.js'
import { AI_PROMPT_CONTRACTS } from '../src/catalog/contracts-ai-prompt.js'

const catalog=createCatalog({capabilities:ALL_CAPABILITY_DEFINITIONS})
const installed=ALL_CAPABILITY_DEFINITIONS.some(d=>d.id==='ai-knowledge-workspace-list')
function get(id:string){const d=catalog.describe(id);if(!d.ok||!d.ai)throw new Error(`Missing ${id}`);return {...d,ai:d.ai}}
function field(id:string,path:string){const f=get(id).returns.fields?.find(f=>f.path===path);if(!f)throw new Error(`Missing ${id}.${path}`);return f}

describe.skipIf(!installed)('知识、问答与提示工程：SDK实际描述和业务响应核对',()=>{
 it('逐能力接线、页内选择与参数含义来自同一份契约',()=>{
  for(const id of [...Object.keys(AI_CORE_CONTRACTS),...Object.keys(AI_PROMPT_CONTRACTS)]){
   const d=get(id);expect(d.invoke).not.toBeNull()
   const def=ALL_CAPABILITY_DEFINITIONS.find(c=>c.id===id)!
   for(const p of def.params)expect(d.params.find(c=>c.name===p.name)?.contract?.meaning).toBe(d.ai.inputs[p.name]?.meaning)
   const page=catalog.describePage(def.pagePath);if(!page.ok)throw new Error(def.pagePath)
   expect(page.capabilities.find(c=>c.capabilityId===id)?.effect).toBe(d.ai.effect)
   expect(page.capabilities.find(c=>c.capabilityId===id)?.whenToUse).toBe(d.ai.whenToUse)
  }
 })
 it('知识目录无total，审核id不是文件id，改名回查newContent',async()=>{
  const modulePath='../src/capabilities/ai-knowledge.js'
  const {createAiKnowledgeCapability}=await import(modulePath)
  const sdk=createAiKnowledgeCapability(async()=>({isAdmin:true,list:[{id:71,type:1,parentId:0,name:'旧名',auditStatus:2}]}),async()=>({list:[{id:99,knowledgeId:71,fileId:71,newContent:'新名',auditStatus:2}],total:1}))
  expect(await sdk.listChildren({parentId:0})).not.toHaveProperty('total')
  expect(get('ai-knowledge-workspace-list').returns.fields?.map(f=>f.path)).not.toContain('total')
  const records=await sdk.listRecords({auditStatus:2});expect(records.list[0]).toMatchObject({id:99,fileId:71})
  expect(field('ai-knowledge-review-list','list[].newContent').meaning).toContain('重命名目标')
  expect(field('ai-knowledge-review-list','list[].id').meaning).toContain('不是文件id')
  expect(get('ai-knowledge-review-list').ai.steps[0]?.mapping?.id).toBe('result.list[].id')
  expect(get('ai-knowledge-workspace-rename').ai.completion).toContain('newContent')
  expect(field('ai-knowledge-review-list','list[].auditStatus').values).toEqual({1:'审核成功',2:'待审核',3:'审核失败'})
 })
 it('问答无操作返回useful=null而非-1；转热门须另查热门行id',()=>{
  expect(field('ai-interaction-chat-list','list[].useful').values?.null).toContain('status=-1')
  expect(field('ai-interaction-chat-list','list[].useful').values).not.toHaveProperty('-1')
  expect(field('ai-interaction-chat-list','list[].id').meaning).toContain('chat-get/set-display/convert-hot')
  expect(get('ai-interaction-chat-convert-hot').returns.shape).toBe('null')
  expect(get('ai-interaction-chat-convert-hot').ai.steps.find(s=>s.role==='cancel')?.capabilityId).toBe('ai-interaction-hot-question-remove')
  expect(get('ai-interaction-chat-set-display').howToCall.idempotency).toContain('未包SDK requestId')
 })
 it('试检只读POST返回命中词，白名单删除是物理删除',async()=>{
  const modulePath='../src/capabilities/ai-interaction-qa.js'
  const {createAiInteractionQaCapability}=await import(modulePath)
  const calls:object[]=[];const request=async(c:object)=>{calls.push(c);return ['词A']}
  const sdk=createAiInteractionQaCapability(request,request,request,request)
  expect(await sdk.checkSensitiveWords('文本词A')).toEqual(['词A'])
  expect(calls[0]).toMatchObject({method:'post',data:{word:'文本词A'}})
  expect(get('ai-interaction-sensitive-word-check').ai.effect).toBe('read')
  expect(get('ai-interaction-sensitive-word-check').returns.shape).toBe('string[]')
  expect(get('ai-interaction-sensitive-word-remove').ai.purpose).toContain('物理删除')
 })
 it('业务事件create仅prepare，submit/cancel真实下钻并且不自动撤销',async()=>{
  const modulePath='../src/capabilities/ai-prompt-tool.js'
  const {createAiPromptToolCapability}=await import(modulePath)
  const calls:object[]=[];const request=async(c:object)=>{calls.push(c);return 81}
  const sdk=createAiPromptToolCapability(request,request,request)
  const plan=await sdk.businessEvent.prepareCreate({eventName:'测试事件',useSystem:10,enabled:false})
  expect(calls).toHaveLength(0);expect(plan.undo).toBeNull()
  expect(get('ai-business-event-create').ai.effect).toBe('prepare')
  expect(ALL_CAPABILITY_DEFINITIONS.find(d=>d.id==='ai-business-event-create')?.write).toBe(false)
  expect(get('ai-business-event-create').returns.fields?.find(f=>f.path==='request')?.meaning).toContain('尚未发送')
  const described=catalog.describeMethod('aiPromptTool.businessEvent.submit');if(!described.ok)throw new Error('submit missing')
  expect(described.ai.effect).toBe('write');expect(described.ai.inputs.plan?.required).toBe(true)
  expect(await sdk.businessEvent.submit(plan)).toBe(81);expect(calls).toHaveLength(1)
  await expect(sdk.businessEvent.cancel(plan)).rejects.toThrow('撤销不了')
  expect(get('ai-business-event-create').ai.steps.find(s=>s.role==='cancel')?.when).toContain('undo非null')
 })
 it('事件记录eventCode映射、毫秒单位和可重试状态不混用',()=>{
  expect(get('ai-business-event-list').ai.steps[0]?.mapping).toEqual({eventCode:'result.list[].eventCode'})
  expect(field('ai-business-event-record-get','status').values).toEqual({0:'待执行',1:'执行中',2:'成功',3:'失败',4:'跳过',5:'超时'})
  expect(field('ai-business-event-record-get','durationMs').meaning).toContain('毫秒')
  expect(get('ai-business-event-record-retry').ai.boundaries.join(' ')).toContain('status=3/4/5')
 })
 it('字典value不同于id，模板内容来自name，技能id不同于类型值',()=>{
  const d=get('ai-open-api-registry-create')
  expect(d.params.find(p=>p.name==='httpMethod')?.contract?.lookup).toMatchObject({capabilityId:'base-dict-get',args:{dictType:'open_api_http_method_type'},valueField:'entries[].value',labelField:'entries[].label'})
  expect(get('ai-prompt-template-binding-create').ai.inputs.templateContent?.source).toContain('候选的name')
  expect(get('ai-prompt-tip-type-options').ai.steps[0]?.mapping).toEqual({typeId:'result.[].id',useType:'result.[].name'})
 })
 it('技能审核无效标志和完整草案保存分开，预览token不是计费',()=>{
  expect(field('ai-prompt-skill-prepare','variables.executionFailed').meaning).toContain('审核无效')
  expect(field('ai-prompt-skill-prepare','variables.parseFailed').meaning).toContain('审核无效')
  expect(get('ai-prompt-skill-prepare').ai.steps[0]?.instruction).toContain('不能将审核返回')
  expect(get('ai-prompt-skill-submit').ai.boundaries.join(' ')).toContain('nodes整树替换')
  expect(field('ai-prompt-skill-preview','totalTokenCount').meaning).toContain('不是实际计费量')
  expect(field('ai-prompt-skill-get','nodes[].cardConfig.buttons[].pcActionValue').meaning).toContain('PC')
 })
 it('开放接口扫描没有登记id；绑定创建null、修改删除boolean，卡片按钮有嵌套说明',()=>{
  expect(get('ai-open-api-registry-scan').returns.fields?.map(f=>f.path)).not.toContain('[].id')
  expect(get('ai-open-api-registry-scan').ai.output.empty).toContain('不会归一为[]')
  expect(get('ai-open-api-registry-scan').ai.consume.join(' ')).toContain('不能直接作为技能apiIds')
  expect(field('ai-prompt-skill-card-list','[].buttons[].pcActionValue').meaning).toContain('PC')
  const d=catalog.describeMethod('aiPromptTool.templateBinding.submit');if(!d.ok)throw new Error('missing binding submit')
  expect(d.ai.output.shape).toBe('boolean|null')
 })

 it('准备新建包含id:null；节点仅0禁用；混合预览total不是混合总量',async()=>{
  const qaPath='../src/capabilities/ai-interaction-qa.js';const promptPath='../src/capabilities/ai-prompt.js'
  const {createAiInteractionQaCapability}=await import(qaPath);const {buildSkillConfigPayload}=await import(promptPath)
  const request=async()=>null;const qa=createAiInteractionQaCapability(request,request,request,request)
  expect((await qa.prepareCreateHotQuestion({question:'问题',sort:1})).payload.id).toBeNull()
  expect(qa.prepareCreateWhitelistWord({word:'词'}).payload.id).toBeNull()
  for(const path of ['aiInteractionQa.prepareCreateHotQuestion','aiInteractionQa.prepareCreateWhitelistWord']){
   const d=catalog.describeMethod(path);if(!d.ok)throw new Error(path)
   expect(d.ai.output.fields.find(f=>f.path==='payload.id')?.type).toBe('null')
  }
  const payload=buildSkillConfigPayload({nodes:[{nodeType:1,enabled:2},{nodeType:1,enabled:0}]})
  expect(payload.nodes.map((n:{enabled:number})=>n.enabled)).toEqual([1,0])
  expect(get('ai-prompt-skill-submit').ai.inputs['nodes[].enabled']?.meaning).toContain('仅Number(enabled)===0禁用')
  expect(field('ai-interaction-hot-topics-list','total').meaning).toContain('不是混合输出总数')
  expect(field('ai-interaction-hot-topics-list','list[].type').values).toEqual({1:'人工',2:'系统'})
 })

})
