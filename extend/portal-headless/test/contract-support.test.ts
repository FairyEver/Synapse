import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { createContractSupport, contractSupportCapabilities, CONTRACT_SUPPORT_METHODS, type ContractSupportRequests } from '../src/capabilities/contract-support.js'
import { CONTRACT_SUPPORT_CONTRACTS } from '../src/catalog/contracts-support.js'
import { createPortalHeadless } from '../src/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import { createCatalog } from '../src/catalog/index.js'
const originalAdapter=axios.defaults.adapter
afterEach(()=>{axios.defaults.adapter=originalAdapter})
const catalog=createCatalog({capabilities:ALL_CAPABILITY_DEFINITIONS})
function ai(id:string){const d=catalog.describe(id);if(!d.ok||!d.ai)throw Error('Missing SDK description '+id);return d.ai}
function setup(result:unknown){const calls: Array<{scope:string;config:unknown}>=[];const requests=Object.fromEntries(['performanceRequest','hrRequest','contractRequest','platformRequest','learningRequest','learningCourseRequest','financeRequest'].map(scope=>[scope,async(config:unknown)=>{calls.push({scope,config});return result}])) as ContractSupportRequests;return {api:createContractSupport(requests),calls}}
describe('contract support actual selectors and descriptions',()=>{
 it('all 12 real support abilities are registered, bound and describe their actual input/output',()=>{
  expect(contractSupportCapabilities).toHaveLength(12)
  for(const d of contractSupportCapabilities){const out=catalog.describe(d.id);expect(out.ok).toBe(true);if(out.ok){expect(out.invoke?.sdkPath).toBe('contractSupport.'+CONTRACT_SUPPORT_METHODS[d.id]);expect(out.ai).toEqual(CONTRACT_SUPPORT_CONTRACTS[d.id]);if(d.id.endsWith('-search'))expect(out.params.find(p=>p.name==='keyword')?.required).toBe(true)}}
 })
 it('every long selector rejects missing keyword before any request',async()=>{
  const {api,calls}=setup([])
  for(const[id,method] of Object.entries(CONTRACT_SUPPORT_METHODS)){if(id.endsWith('-search'))await expect(async()=>api[method]({keyword:' '} as never)).rejects.toThrow('keyword')}
  expect(calls).toHaveLength(0)
 })
 it('role scopes stay separate; ids are not organization code and new ancestors can be disabled',async()=>{
  const {api,calls}=setup([{id:11,name:'研发总公司',code:'ORG-11',isSelected:1,children:[{id:12,name:'研发一部',code:'ORG-12',children:[]}]}])
  const perf=await api.roleOrganizationSearch({keyword:'研发',limit:1})
  expect(perf).toMatchObject({total:2,truncated:true,list:[{id:'11',code:'ORG-11',selectable:false}]})
  await api.roleOrganizationSearch({keyword:'一部',scope:'attendance'})
  const monthly=await api.roleOrganizationNewSearch({keyword:'一部'})
  expect(calls.map(c=>c.scope)).toEqual(['performanceRequest','hrRequest','performanceRequest'])
  expect(monthly.list[0]).toMatchObject({id:'12',parentId:'11',selectable:true,path:[{id:'11',name:'研发总公司'},{id:'12',name:'研发一部'}]})
  expect(ai('contract-support-role-organization-search').steps.find(s=>s.capabilityId==='perf-year-agreement-others-list')?.mapping).toEqual({organizationCode:'result.list[].id'})
  expect(ai('contract-support-role-organization-new-search').consume.join(' ')).toContain('selectable=true')
 })
 it('category contract_type returns only leaves and is not a grouped dictionary',async()=>{
  const {api,calls}=setup([{id:1,name:'合作合同',code:'contract_type',children:[{id:21,name:'采购',code:'purchase'},{id:22,name:'销售',code:'sale'}]}])
  const out=await api.contractTypeSearch({keyword:'合作合同'})
  expect(out.list.map(x=>x.id)).toEqual(['21','22'])
  expect(calls[0]).toEqual({scope:'contractRequest',config:{url:'/admin-api/system/category-dict/getChildNodeTree',method:'get',params:{code:'contract_type'}}})
  expect(ai('contract-support-contract-type-search').steps[0]?.mapping).toEqual({typeId:'result.list[].id'})
 })
 it('post search asks backend only for actual posts, preserves pagination and never substitutes folder IDs',async()=>{
  const {api,calls}=setup({list:[{id:7,postId:7,name:'研发岗',dataType:2,parentId:3,status:0,ancestorPath:[{id:3,name:'研发类',available:true}]}],total:21})
  const out=await api.postSearch({keyword:'研发',pageNo:1,pageSize:20})
  expect(calls[0]).toEqual({scope:'hrRequest',config:{url:'/admin-api/org/hrpost/searchPage',method:'get',params:{keyword:'研发',pageNo:1,pageSize:20,dataType:2,selection:true}}})
  expect(out).toMatchObject({total:21,hasMore:true,list:[{id:'7',postId:'7',status:0,ancestors:[{id:'3',name:'研发类',available:true}]}]})
  expect(ai('contract-support-post-search').output.fields.find(f=>f.path==='list[].status')?.values).toEqual({'0':'未使用','1':'正在使用'})
  const bad=setup({list:[{id:3,name:'研发目录',dataType:1}],total:1})
  await expect(bad.api.postSearch({keyword:'研发'})).rejects.toThrow('非岗位文件夹')
 })
 it('dutyName maps to name, platform role uses system10 and real IDs',async()=>{
  const duty=setup([{id:42,dutyName:'技术经理',dutyLevelId:'9'}]);expect((await duty.api.dutySearch({keyword:'经理'})).list[0]).toMatchObject({id:'42',name:'技术经理'});
  const role=setup([{id:51,name:'知识管理员',code:'ADMIN'}]);expect((await role.api.roleSearch({keyword:'知识'})).list[0]?.id).toBe('51');expect(role.calls[0]).toMatchObject({scope:'platformRequest',config:{params:{useSystem:10}}})
  if(ALL_CAPABILITY_DEFINITIONS.some(d=>d.id==='ai-knowledge-workspace-set-permission'))expect(ai('contract-support-role-search').steps[0]?.mapping).toEqual({authRoleIds:'result.list[].id',isAllManager:'literal:2'})
 })
 it('travel budget uses PERSON detail not SOCIETY or main ID and detailCode becomes budgetDetailNo',async()=>{
  const {api,calls}=setup([{id:71,budgetDetailId:71,budgetId:70,detailCode:'YS-001-1',budgetNo:'YS-001',budgetMonth:'2026-09',orgName:'研发',detailType:'差旅费',amount:'100.00',availableBalance:'15.00',occupiedAmount:'85.00',selectable:true}])
  const out=await api.travelBudgetSearch({keyword:'差旅',orgId:12,budgetMonth:'2026-09',applyAmount:20})
  expect(calls[0]).toEqual({scope:'financeRequest',config:{url:'/admin-api/finance/spending-budget-person/list',method:'post',data:{orgId:'12',budgetMonth:'2026-09',applyAmount:20}}})
  expect(out.list[0]).toMatchObject({id:'71',budgetId:'70',budgetDetailNo:'YS-001-1',availableBalance:'15.00',selectable:false,disabledReason:'预算不足'})
  expect(ai('contract-support-travel-budget-search').steps[0]?.mapping).toEqual({'travelEntryList[].budgetDetailId':'result.list[].id','travelEntryList[].budgetDetailNo':'result.list[].budgetDetailNo'})
  expect(ai('contract-support-travel-budget-search').output.fields.find(f=>f.path==='list[].availableBalance')?.unit).toBe('元')
  expect(ai('contract-support-travel-budget-search').inputs.applyAmount?.source).toContain('trafficAmount+foodAmount+housingAmount+otherAmount+inputTaxAmount')
  expect(ai('contract-support-travel-budget-search').boundaries.join(' ')).toContain('自身及祖先orgIds')
 })
 it('finance selectors use revenue leaves and available legal person IDs rather than org IDs',async()=>{
  const revenue=setup([{id:9,name:'商品销售',code:'600101'}]);const r=await revenue.api.revenueSubjectSearch({keyword:'商品'});expect(r.list[0]).toMatchObject({id:'9',code:'600101'});expect(revenue.calls[0]).toMatchObject({config:{params:{rootName:'主营业务收入'}}})
  const corporation=setup([{id:55,name:'研发有限公司',superOrganizationId:11}]);const c=await corporation.api.corporationSearch({keyword:'研发'});expect(c.list[0]?.id).toBe('55');expect(corporation.calls[0]).toMatchObject({config:{params:{name:'研发'}}})
  expect(ai('contract-support-corporation-search').steps[0]?.mapping).toEqual({corporationId:'result.list[].id'})
  expect(ai('contract-support-corporation-search').steps[0]?.role).toBe('required')
  expect(ai('contract-support-corporation-search').steps[0]?.instruction).toContain('不能沿用另一法人的账户')
 })
 it('real SDK invoke preserves smart-layer envelope and /api path; context headers are13/11/15/12 and finance form has none',async()=>{
  const calls:InternalAxiosRequestConfig[]=[]
  axios.defaults.adapter=async config=>{calls.push(config);const data=[{id:3,name:'思想教育',children:[{id:4,name:'思想章节'}]}];return{data:config.baseURL==='https://learning.invalid'?{code:200,data}:{ret:'SUCCESS',data},status:200,statusText:'OK',headers:{},config}}
  const sdk=createPortalHeadless({baseUrl:'https://portal.invalid',httpBaseUrls:{'smart-layer-app':'https://learning.invalid'},credential:{token:'fixture',tenantId:1}})
  const course=await sdk.capabilities.invoke('contract-support-learning-course-search',{keyword:'思想'}) as {list:Array<{id:string;name:string}>}
  expect(course.list.map(x=>x.id)).toEqual(['3','4'])
  expect(calls[0]?.baseURL).toBe('https://learning.invalid');expect(calls[0]?.url).toBe('/api/zhdj/studyLessonCatalogue/getChapterTree');expect(calls[0]?.params).toMatchObject({type:2})
  await sdk.contractSupport.roleOrganizationSearch({keyword:'思想'})
  await sdk.contractSupport.roleOrganizationSearch({keyword:'思想',scope:'attendance'})
  await sdk.contractSupport.contractTypeSearch({keyword:'思想'})
  await sdk.contractSupport.learningOrganizationSearch({keyword:'思想'})
  await sdk.contractSupport.revenueSubjectSearch({keyword:'思想'})
  expect(calls.slice(1,5).map(c=>Number(c.headers.get('module-type')))).toEqual([13,11,15,12])
  expect(calls[5]?.headers.get('module-type')).toBeUndefined()
  expect(calls[1]?.url).toContain('/admin-api/org/organization/getRoleOrganizationTree?')
  expect(calls[3]?.url).not.toContain('/admin-api/admin-api')
  const description=sdk.catalog.describe('contract-support-learning-course-search');if(!description.ok)throw Error('missing course description');expect(description.ai?.boundaries.join(' ')).toContain('smart-layer-app')
  expect(contractSupportCapabilities.find(d=>d.id==='contract-support-learning-course-search')?.httpInstance).toBe('smart-layer-app')
 })
 it('corporation detail invokes real SDK, clears foreign fields from projection and preserves bank account leading zeros',async()=>{
  let sent:InternalAxiosRequestConfig|undefined
  const data={payeeType:2,companySubType:1,receivingCorporationId:55,receivingCorporationName:'研发法人',receivingCompanyName:'研发法人',receivingBankName:'测试银行支行',receivingAccount:'00123000',receivingCompanyId:999,payeeId:888}
  axios.defaults.adapter=async config=>{sent=config;return{data:{ret:'SUCCESS',data},status:200,statusText:'OK',headers:{},config}}
  const sdk=createPortalHeadless({baseUrl:'https://portal.invalid',credential:{token:'fixture',tenantId:1}})
  const result=await sdk.capabilities.invoke('contract-support-corporation-payee-get',{corporationId:'55'})
  expect(result).toEqual({payeeType:2,companySubType:1,receivingCorporationId:'55',receivingCorporationName:'研发法人',receivingCompanyName:'研发法人',receivingBankName:'测试银行支行',receivingAccount:'00123000'})
  expect(sent?.url).toContain('/admin-api/finance/payee-info/internal-corporation?corporationId=55')
  expect(sent?.headers.get('module-type')).toBeUndefined()
  await expect(setup({...data,receivingAccount:null}).api.corporationPayee({corporationId:55})).rejects.toThrow('缺失')
  await expect(setup(data).api.corporationPayee({corporationId:56})).rejects.toThrow('ID与查询不一致')
  expect(ai('contract-support-corporation-payee-get').consume.join(' ')).toContain('receivingBankDictValue')
  expect(ai('contract-support-corporation-payee-get').steps[0]?.mapping?.['payeeInfo.receivingAccount']).toBe('result.receivingAccount')
 })
 it('external learning service has no Portal URL fallback when instance baseUrl is missing',async()=>{
  let requests=0;axios.defaults.adapter=async()=>{requests++;throw Error('must not send')}
  const sdk=createPortalHeadless({baseUrl:'https://portal.invalid',credential:{token:'fixture',tenantId:1}})
  await expect(sdk.contractSupport.learningCourseSearch({keyword:'思想'})).rejects.toThrow('smart-layer-app')
  expect(requests).toBe(0)
 })
 it('all support descriptions pass complete contract shape and registered target checks',async()=>{
  const {validateAiContract}=await import(new URL('../tools/ai-contract/validate.mjs',import.meta.url).href)
  const {CAPABILITY_BINDINGS}=await import('../src/capabilities/invoke.js')
  const bindings=Object.fromEntries(CAPABILITY_BINDINGS.map(b=>[b.capabilityId,b.sdkPath]))
  const contracts=Object.fromEntries(ALL_CAPABILITY_DEFINITIONS.map(d=>{const c=catalog.describe(d.id);return[d.id,c.ok?c.ai:null]}))
  for(const[id,c]of Object.entries(CONTRACT_SUPPORT_CONTRACTS))expect(validateAiContract(id,c,{profile:'complete',definitions:ALL_CAPABILITY_DEFINITIONS,contracts,bindings,sdkPaths:CAPABILITY_BINDINGS.map(b=>b.sdkPath)}),id).toEqual([])
 })
 it('malformed/unsafe IDs and nonarray data fail instead of silently returning empty candidates',async()=>{
  await expect(setup({list:[]}).api.roleSearch({keyword:'知识'})).rejects.toThrow('需要数组')
  await expect(setup([{id:Number.MAX_SAFE_INTEGER+1,name:'知识'}]).api.roleSearch({keyword:'知识'})).rejects.toThrow('安全整数')
 })
})
