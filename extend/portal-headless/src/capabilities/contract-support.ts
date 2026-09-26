import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PortalRequest } from './meeting-room.js'

/** Read-only selectors derived from web d3cf56bdc76c / Java dcb3f360194. No inferred IDs. */
export const CONTRACT_SUPPORT_PAGE_PATH='/base-data/contract-support'
export const CONTRACT_SUPPORT_CONTEXTS={performance:'/dashboard/salary/main/list',hr:'/dashboard/attendance/attendance-team/list',contract:'/dashboard/contract/template/list',platform:'/dashboard/platform/intelligence/knowledge/document/workspace/list',learning:'/dashboard/statistics/learning/list',finance:'/simple/finance/form/003'} as const
export const CONTRACT_SUPPORT_URLS={roleOrganization:'/admin-api/org/organization/getRoleOrganizationTree',roleOrganizationNew:'/admin-api/org/organization/getRoleOrganizationTreeNew',role:'/admin-api/sys/role/listByUseSystem',post:'/admin-api/org/hrpost/searchPage',duty:'/admin-api/org/hrduty/all',contractType:'/admin-api/system/category-dict/getChildNodeTree',learningCourse:'/api/zhdj/studyLessonCatalogue/getChapterTree',learningOrganization:'/admin-api/org/organization/getTree',travelBudget:'/admin-api/finance/spending-budget-person/list',revenueSubject:'/admin-api/finance/ledger-accounts/leaf-list',corporation:'/admin-api/org/corporation/getAllLegalPerson',corporationPayee:'/admin-api/finance/payee-info/internal-corporation'} as const
export type ContractSupportRequests={performanceRequest:PortalRequest;hrRequest:PortalRequest;contractRequest:PortalRequest;platformRequest:PortalRequest;learningRequest:PortalRequest;learningCourseRequest:PortalRequest;financeRequest:PortalRequest}
export type CandidateQuery={keyword:string;limit?:number}
export type Candidate={id:string;name:string;code:string|null;parentId:string|null;path: Array<{id:string;name:string}>;hasChildren:boolean;selectable:boolean}
export type CandidateSlice<T>={list:T[];total:number;limit:number;truncated:boolean}
type Row=Record<string,unknown>
function object(value:unknown):Row {if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('候选响应形状错误：需要对象');return value as Row}
function array(value:unknown):unknown[]{if(!Array.isArray(value))throw new Error('候选响应形状错误：需要数组');return value}
function id(value:unknown):string {if((typeof value!=='string'&&typeof value!=='number')||String(value).trim()===''||(typeof value==='number'&&!Number.isSafeInteger(value)))throw new Error('候选标识缺失或数字ID超出安全整数范围');return String(value)}
function text(value:unknown):string {if(typeof value!=='string'||!value.trim())throw new Error('候选名称缺失');return value}
function optionalText(value:unknown):string|null{return value===undefined||value===null?null:String(value)}
function optionalId(value:unknown):string|null{return value===undefined||value===null?null:id(value)}
function keyword(value:unknown):string {if(typeof value!=='string'||!value.trim())throw new Error('keyword必填：先提供名称关键字');const out=value.trim();if(out.length>100)throw new Error('keyword最多100字');return out}
function integer(value:unknown,fallback:number,max:number,label:string):number {if(value===undefined)return fallback;if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>max)throw new Error(`${label}必须为1至${max}的整数`);return value}
function slice<T>(rows:T[],query:CandidateQuery,getSearch:(row:T)=>string):CandidateSlice<T>{const q=keyword(query.keyword).toLocaleLowerCase();const limit=integer(query.limit,20,100,'limit');const hits=rows.filter(r=>getSearch(r).toLocaleLowerCase().includes(q));return {list:hits.slice(0,limit),total:hits.length,limit,truncated:hits.length>limit}}
function queryGuard(q:CandidateQuery){keyword(q.keyword);integer(q.limit,20,100,'limit')}
function tree(value:unknown,leafOnly=false):Candidate[]{const out:Candidate[]=[];function visit(values:unknown[],parents:Candidate['path']){for(const value of values){const r=object(value);const rowId=id(r.id),name=text(r.name);const children=r.children==null?[]:array(r.children);const path=[...parents,{id:rowId,name}];if(!leafOnly||!children.length)out.push({id:rowId,name,code:optionalText(r.code),parentId:optionalId(r.pid??parents.at(-1)?.id),path,hasChildren:children.length>0,selectable:r.isSelected!==1&&r.isSelected!=='1'});visit(children,path)}}visit(array(value),[]);return out}
function flat(value:unknown,nameKey='name'):Candidate[]{return array(value).map(v=>{const r=object(v),rowId=id(r.id),name=text(r[nameKey]);return {id:rowId,name,code:optionalText(r.code),parentId:null,path:[{id:rowId,name}],hasChildren:false,selectable:true}})}
const candidateSearch=(r:Candidate)=>[r.name,r.code,...r.path.map(p=>p.name)].join(' ')
function decimal(value:unknown):number|string|null {if(value===null||value===undefined)return null;if((typeof value==='string'&&value.trim()!==''||typeof value==='number')&&Number.isFinite(Number(value)))return value as number|string;throw new Error('预算金额响应不是有限数字或十进制字符串')}

export function createContractSupport(requests:ContractSupportRequests){
 async function treeSearch(request:PortalRequest,url:string,q:CandidateQuery,params?:Record<string,unknown>,leafOnly=false){queryGuard(q);return slice(tree(await request({url,method:'get',...(params?{params}:{})}),leafOnly),q,candidateSearch)}
 async function flatSearch(request:PortalRequest,url:string,q:CandidateQuery,params?:Record<string,unknown>,nameKey='name'){queryGuard(q);return slice(flat(await request({url,method:'get',...(params?{params}:{})}),nameKey),q,candidateSearch)}
 return {
  roleOrganizationSearch(q:CandidateQuery&{scope?:'performance'|'attendance'}){if(q.scope!==undefined&&!['performance','attendance'].includes(q.scope))throw new Error('scope必须为performance或attendance');return treeSearch(q.scope==='attendance'?requests.hrRequest:requests.performanceRequest,CONTRACT_SUPPORT_URLS.roleOrganization,q)},
  roleOrganizationNewSearch(q:CandidateQuery){return treeSearch(requests.performanceRequest,CONTRACT_SUPPORT_URLS.roleOrganizationNew,q)},
  roleSearch(q:CandidateQuery){return flatSearch(requests.platformRequest,CONTRACT_SUPPORT_URLS.role,q,{useSystem:10})},
  async postSearch(q:{keyword:string;pageNo?:number;pageSize?:number}){const k=keyword(q.keyword),pageNo=integer(q.pageNo,1,1000000,'pageNo'),pageSize=integer(q.pageSize,20,100,'pageSize');const data=object(await requests.hrRequest({url:CONTRACT_SUPPORT_URLS.post,method:'get',params:{keyword:k,pageNo,pageSize,dataType:2,selection:true}}));if(typeof data.total!=='number'||!Number.isSafeInteger(data.total)||data.total<0)throw new Error('岗位分页total形状错误');const list=array(data.list).map(v=>{const r=object(v);if(Number(r.dataType)!==2)throw new Error('岗位候选返回了非岗位文件夹');const rowId=id(r.id),name=text(r.name);const ancestors=(r.ancestorPath==null?[]:array(r.ancestorPath)).map(v=>{const a=object(v);return{id:id(a.id),name:optionalText(a.name),available:a.available!==false}});return{id:rowId,name,postId:optionalId(r.postId),parentId:optionalId(r.parentId),status:r.status==null?null:Number(r.status),ancestors}});return{list,total:data.total,pageNo,pageSize,hasMore:pageNo*pageSize<data.total}},
  dutySearch(q:CandidateQuery){return flatSearch(requests.hrRequest,CONTRACT_SUPPORT_URLS.duty,q,undefined,'dutyName')},
  contractTypeSearch(q:CandidateQuery){return treeSearch(requests.contractRequest,CONTRACT_SUPPORT_URLS.contractType,q,{code:'contract_type'},true)},
  learningCourseSearch(q:CandidateQuery){return treeSearch(requests.learningCourseRequest,CONTRACT_SUPPORT_URLS.learningCourse,q,{type:2})},
  learningOrganizationSearch(q:CandidateQuery){return treeSearch(requests.learningRequest,CONTRACT_SUPPORT_URLS.learningOrganization,q,{roleId:''})},
  async travelBudgetSearch(q:CandidateQuery&{orgId:number|string;budgetMonth:string;applyAmount?:number}){queryGuard(q);const orgId=id(q.orgId);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.budgetMonth))throw new Error('budgetMonth必须为YYYY-MM');if(q.applyAmount!==undefined&&(!Number.isFinite(q.applyAmount)||q.applyAmount<0))throw new Error('applyAmount必须为非负元金额');const data=await requests.financeRequest({url:CONTRACT_SUPPORT_URLS.travelBudget,method:'post',data:{orgId,budgetMonth:q.budgetMonth,...(q.applyAmount===undefined?{}:{applyAmount:q.applyAmount})}});const rows=array(data).map(v=>{const r=object(v);const availableBalance=decimal(r.availableAmount??r.availableBalance),amount=decimal(r.amount),occupiedAmount=decimal(r.occupiedAmount);let disabledReason=optionalText(r.disabledReason);if(!disabledReason&&availableBalance!==null&&Number(availableBalance)<=0)disabledReason='可用金额为0';if(!disabledReason&&availableBalance!==null&&q.applyAmount!==undefined&&Number(availableBalance)<q.applyAmount)disabledReason='预算不足';return{id:id(r.budgetDetailId??r.id),budgetDetailNo:optionalText(r.detailCode),budgetId:optionalId(r.budgetId),budgetNo:optionalText(r.budgetNo),budgetType:optionalText(r.budgetType),budgetMonth:optionalText(r.budgetMonth),orgName:optionalText(r.orgName),detail:optionalId(r.detail),detailType:optionalText(r.detailType),amount,availableBalance,occupiedAmount,paymentDate:optionalText(r.paymentDate),selectable:r.selectable!==false&&r.selectable!==0&&r.selectable!=='false'&&!disabledReason,disabledReason}});return slice(rows,q,r=>[r.budgetDetailNo,r.budgetNo,r.orgName,r.detailType].join(' '))},
  revenueSubjectSearch(q:CandidateQuery){return flatSearch(requests.financeRequest,CONTRACT_SUPPORT_URLS.revenueSubject,q,{rootName:'主营业务收入'})},
  async corporationPayee(q:{corporationId:number|string}){const corporationId=id(q.corporationId);const r=object(await requests.financeRequest({url:CONTRACT_SUPPORT_URLS.corporationPayee,method:'get',params:{corporationId}}));const returnedId=id(r.receivingCorporationId);if(returnedId!==corporationId)throw new Error('收款法人响应ID与查询不一致');if(Number(r.payeeType)!==2||Number(r.companySubType)!==1)throw new Error('收款法人响应不是内部分公司');return{payeeType:2 as const,companySubType:1 as const,receivingCorporationId:returnedId,receivingCorporationName:text(r.receivingCorporationName),receivingCompanyName:text(r.receivingCompanyName),receivingBankName:text(r.receivingBankName),receivingAccount:text(r.receivingAccount)}},
  corporationSearch(q:CandidateQuery){queryGuard(q);return flatSearch(requests.financeRequest,CONTRACT_SUPPORT_URLS.corporation,q,{name:q.keyword.trim()})},
 }
}
export type ContractSupport=ReturnType<typeof createContractSupport>
const searchParams:ParamSpec[]=[{name:'keyword',kind:'text',required:true,description:'先提供名称关键字，去首尾空白后1至100字；不得用空串请求所有候选'},{name:'limit',kind:'number',required:false,description:'本地候选最多返回条数；默认20，1至100整数；truncated=true须细化keyword或增大limit'}]
const definitions: Array<CapabilityDefinition & { sdkMethod: keyof ContractSupport }> = [
  {
    id: 'contract-support-role-organization-search',
    title: '按角色搜索组织',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'roleOrganizationSearch',
    params: [{"name":"keyword","kind":"text","required":true,"description":"先提供名称关键字，去首尾空白后1至100字；不得用空串请求所有候选"},{"name":"limit","kind":"number","required":false,"description":"本地候选最多返回条数；默认20，1至100整数；truncated=true须细化keyword或增大limit"},{"name":"scope","kind":"enum","required":false,"description":"performance绩效范围（默认）；attendance考勤范围；两者module-type不同","options":[{"value":"performance","label":"绩效"},{"value":"attendance","label":"考勤"}]}],
  },
  {
    id: 'contract-support-role-organization-new-search',
    title: '搜索月度他人协议组织',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'roleOrganizationNewSearch',
    params: searchParams,
  },
  {
    id: 'contract-support-role-search',
    title: '搜索知识权限角色',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'roleSearch',
    params: searchParams,
  },
  {
    id: 'contract-support-post-search',
    title: '搜索排班岗位',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'postSearch',
    params: [{"name":"keyword","kind":"text","required":true,"description":"先提供名称关键字，去首尾空白后1至100字；不得用空串请求所有候选"},{"name":"pageNo","kind":"number","required":false,"description":"服务端页码，默认1"},{"name":"pageSize","kind":"number","required":false,"description":"每页默认20，1至100整数"}],
  },
  {
    id: 'contract-support-duty-search',
    title: '搜索排班职务',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'dutySearch',
    params: searchParams,
  },
  {
    id: 'contract-support-contract-type-search',
    title: '搜索合同分类叶子',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'contractTypeSearch',
    params: searchParams,
  },
  {
    id: 'contract-support-learning-course-search',
    title: '搜索智慧蛋鸡课程目录',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'smart-layer-app',
    write: false,
    sdkMethod: 'learningCourseSearch',
    params: searchParams,
  },
  {
    id: 'contract-support-learning-organization-search',
    title: '搜索学习统计组织',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'learningOrganizationSearch',
    params: searchParams,
  },
  {
    id: 'contract-support-travel-budget-search',
    title: '搜索差旅预算明细',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'travelBudgetSearch',
    params: [{"name":"keyword","kind":"text","required":true,"description":"先提供名称关键字，去首尾空白后1至100字；不得用空串请求所有候选"},{"name":"limit","kind":"number","required":false,"description":"本地候选最多返回条数；默认20，1至100整数；truncated=true须细化keyword或增大limit"},{"name":"orgId","kind":"search","required":true,"description":"差旅已选择的费用承担组织ID，与travel-expense-org-options同源","lookup":{"capabilityId":"travel-expense-org-options","keywordParam":"keyword"}},{"name":"budgetMonth","kind":"date","required":true,"description":"预计付款日期的YYYY-MM月份"},{"name":"applyAmount","kind":"number","required":false,"description":"本行本次预算占用金额，单位元，非负；传入后判断是否足够"}],
  },
  {
    id: 'contract-support-corporation-payee-get',
    title: '读取内部法人开户资料',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'corporationPayee',
    params: [{"name":"corporationId","kind":"search","required":true,"description":"已选法人库ID，不能用组织ID","lookup":{"capabilityId":"contract-support-corporation-search","keywordParam":"keyword"}}],
  },
  {
    id: 'contract-support-revenue-subject-search',
    title: '搜索销售费用收入科目',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'revenueSubjectSearch',
    params: searchParams,
  },
  {
    id: 'contract-support-corporation-search',
    title: '搜索可用内部收款法人',
    pagePath: CONTRACT_SUPPORT_PAGE_PATH,
    httpInstance: 'platform',
    write: false,
    sdkMethod: 'corporationSearch',
    params: searchParams,
  },
]
export const contractSupportCapabilities: CapabilityDefinition[] = definitions.map(({ sdkMethod, ...definition }) => definition)
export const CONTRACT_SUPPORT_METHODS = Object.fromEntries(definitions.map(({ id, sdkMethod }) => [id, sdkMethod])) as Record<string, keyof ContractSupport>
