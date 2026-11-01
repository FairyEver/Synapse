/* Presentation/diagnostics only; reads synthetic raw data, never changes a fitted model. */
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib")
const {load}=require("./loader.cjs")
const {seal}=require("./seal.cjs")
const out=process.argv[2];if(!out)throw new Error("Result directory required")
const programGuide=path.relative(path.resolve(out),path.join(__dirname,"README.md")).split(path.sep).join("/")
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),"utf8"))
const completion=read("completion.json"),model=read("recommended-model.json"),fixed=read("fixed-holdout-summary.json"),diagnostic=read("final-summary.json"),inference=read("inference-design.json"),bootstrap=read("bootstrap.json"),manifest=read("manifest.json"),selection=read("selection.json"),history=read("history-final-summary.json"),historyFit=read("history-fit.json"),feeAudit=read("break-even-summary.json")
const sim=load("simulator.ts"),math=load("math.ts"),policy=load("policies.ts")
function raw(prefix){
 const index=read(prefix+"-index.json"),rows=[]
 for(const record of Object.values(index)){
  const text=zlib.gunzipSync(fs.readFileSync(path.join(out,record.file))).toString().trim()
  if(text)for(const line of text.split("\n"))rows.push(JSON.parse(line))
 }
 return rows.sort((a,b)=>a.ordinal-b.ordinal)
}
const allRows=raw("final"),rows=allRows.filter(r=>Number(r.id.slice(r.id.lastIndexOf(":")+1))<inference.fixedPerGroup)
const number=(n,digits=3)=>typeof n==="number"&&Number.isFinite(n)?n.toFixed(digits):"不可估计"
const interval=s=>`${number(s.mean)} ± ${number(s.halfWidth)}`
const tableText=value=>String(value).replaceAll("|","\\|")
const values=group=>group.map(r=>r.voluntary)
const quantile=(xs,p)=>{const a=[...xs].sort((a,b)=>a-b);if(!a.length)return NaN;const i=(a.length-1)*p,j=Math.floor(i);return a[j]+(a[Math.min(j+1,a.length-1)]-a[j])*(i-j)}
const valid=completion.netGatePassed&&completion.calibrationGatePassed&&completion.precisionGroups===completion.totalGroups&&inference.fixedPerGroup>=2048
fs.writeFileSync(path.join(out,"model-status.json"),JSON.stringify({status:valid?"FINITE_RESEARCH_GATES_PASSED":"UNVALIDATED_RESEARCH_CANDIDATE",modelFile:"recommended-model.json",filenameIsNotProductApproval:true,netGatePassed:completion.netGatePassed,calibrationGatePassed:completion.calibrationGatePassed,precisionGroups:completion.precisionGroups,totalGroups:completion.totalGroups,fixedPerGroup:inference.fixedPerGroup,productEnabled:false},null,2)+"\n")
const lines=["# Roll 牌定价与完整对局模拟研究报告","",`研究日期：${manifest.createdAt.slice(0,10)}。数据结束：${completion.completedAt}。` ,"",`**结论：${valid?"候选模型通过本有限策略研究的统计门槛；仍不是GTO或真实玩家保证。":"得到可计算的研究候选公式，但未通过全部验证门槛，不能称为已平衡的正式收费标准。"}**`,"",`固定引擎：\`${manifest.engine.ref}\`。原始配置／代码指纹见 [manifest.json](./manifest.json)，运行结果见 [completion.json](./completion.json)。无产品接入、业务库修改或部署。`,"","## 1. 数学公式与具体参数","","对当前操作档位 t，令：","","- b 为大盲；P 为本人可争夺的已投入普通筹码；E 为付款前本人还能争夺的对手追加筹码上限。","- n 为仍未弃牌人数，包含全下者；k 为本人本手此前已付费 Roll 次数。","- hN/hS 为其他参与者历史普通／超级次数，分别除以 max(1,n−1)。本人次数不进入这两个量。","- c=(牌组,n,阶段)；具体牌值、候选和私人记牌不进入价格。","", "```text", "R_t = s × (a_t,c × b + p_t,c × P + e_t,c × E) × exp(β_t,N × hN + β_t,S × hS)","A_normal = max(1, R_normal)","A_super  = max(A_normal + 1, R_super)","C_t(k)   = ceil(A_t × M(k))","```","",`选中尺度 **s=${model.scale}**；曲线族 **${model.curve}**；斜率参数 **g=${model.growth}**。`,"",model.curve==="linear"?`**M(k)=1+${model.growth}k**。`:model.curve==="quadratic"?`**M(k)=1+${model.growth}k²**。`:`**M(k)=(1+${model.growth})^k**。`,"","两档共用 k。切回普通可降总价；有效筹码变化也可能改变绝对费用。付费后至少留一筹码，付不起时不截断成全部余额。","","54 组全部系数见 [coefficients.csv](./coefficients.csv)；完整精度与回退参数见 [recommended-model.json](./recommended-model.json)。以下数字来自测试网格和模型拟合，不是数学上唯一的公允价。","","### 典型报价","","固定合法起点的公开资金条件，单独改变次数用于展示系数；不是已经连续扣费后的真实余额轨迹。金额为筹码。","","|牌组|人数|阶段|大盲|P|E|普通 k=0/1/2/3|超级 k=0/1/2/3|","|---|---:|---|---:|---:|---:|---|---|"]
for(const variant of ["standard52","short32"])for(const players of [2,6,10])for(const street of ["preflop","flop","turn"]){
 const game=policy.makeSnapshot({variant,players,depth:100,seed:players*12,bigBlind:2},street),o=sim.observation(game)
 const q=kind=>[0,1,2,3].map(count=>sim.quote({...o,count},kind,model)).join(" / ")
 lines.push(`|${variant}|${players}|${street}|${o.bigBlind}|${o.effectivePot}|${o.effectiveFuture}|${q("normal")}|${q("super")}|`)
}
const csv=["variant,players,street,normal_a,normal_p,normal_e,super_a,super_p,super_e"]
for(const [group,c] of Object.entries(model.cells))csv.push([...group.split(":"),...c.normal,...c.super].join(","))
fs.writeFileSync(path.join(out,"coefficients.csv"),csv.join("\n")+"\n")
lines.push("","## 2. 抽样、策略与价格选择","",`训练数据 ${read("train-data.json").rows} 条配对场景；初筛 ${selection.candidates.length} 个候选，再用独立种子复评 ${selection.refined.length} 个候选。选参前未读取最终检验样本。`,"","基础回归用一次干预并关闭未来 Roll 的完整正常下注结局作启发式初始化，保留全部正负样本，不使用最好牌或最高收益样本定价。超级只在随机三个候选中按可见牌策略选择；完整后续下注、边池、他人 Roll、本人继续操作及冻结补偿在候选校准与最终检验中开放并进入结局；不能把初始化称为多次策略价值的精确拟合。","","四类有限下注／停止策略及参数见 manifest；同类与混合对手均有覆盖。它们不是完整贝叶斯或GTO策略。相同随机未来牌优先序仅用于合法耦合，不把已被换走的牌继续发为公共牌。","","选择目标是归一化后最大化“付款方保留的平均增量价值”和“本行动点给对手的新补偿”两项中的较小值；没有用使用率调参。两项等权属于产品设计取舍，不是概率定律。","","## 3. 正式固定样本检验","",`每组固定 ${inference.fixedPerGroup} 条，共 **${fixed.rows}** 条。自适应新增样本不进入本节，避免改变组权重或停止偏差。单位为大盲 BB。`,"","|指标|数量|平均增量净收益 ± 近似95%半宽|分层整手bootstrap 95%区间|","|---|---:|---|---|")
for(const [label,s,b] of [["所有机会（未选当前Roll为零）",fixed.allOpportunitiesNet,bootstrap.all],["当前自主选择Roll",fixed.chosenNet,bootstrap.chosen],["当前选择普通",fixed.byKind.normal,bootstrap.byKind.normal],["当前选择超级",fixed.byKind.super,bootstrap.byKind.super]])lines.push(`|${label}|${s.n}|${interval(s)}|[${number(b.lower)}, ${number(b.upper)}]|`)
lines.push("",`当前操作点平均给对手补偿 **${number(fixed.meanCompensation)} BB**。付款方正式净收益门槛：**${completion.netGatePassed?"通过":"未通过"}**；校准阶段门槛：**${completion.calibrationGatePassed?"通过":"未通过"}**。`,"","这些数值是相对“现在正常出牌、以后仍可Roll”的配对增量，不是绝对赢池率或账号投资收益。随机失败、坏的候选及亏损样本都保留。")
const selectedRows=rows.filter(r=>r.chosen),negative=selectedRows.filter(r=>r.voluntary<0).length
lines.push("",`当前自选者有 **${number(100*negative/(selectedRows.length||1),2)}%** 的单次配对续局增量为负；这是完整随机续局结果，不等同于“抽到坏牌”的概率，也不能保证付费后一定赚回费用。`,"","## 4. 精度诊断与覆盖","",`自适应补样后 ${allRows.length} 条，${completion.precisionGroups}/${completion.totalGroups} 组达到均值误差目标。诊断按每组两档及 ${inference.plannedLooks} 次预定观察作 Bonferroni 正态近似校正，z=${number(inference.diagnosticZ,6)}；不宣称54组联合95%覆盖。`,"","目标是半宽 ≤ max(平均报价10%,0.25 BB)，仅约束分组均值的 Monte Carlo 误差，不代表个人牌面误差或模型预测误差。未达到的组不按“已平衡”宣传。","","|分组|总样本|普通可付费样本|普通净增量±诊断半宽|超级可付费样本|超级净增量±诊断半宽|达标|","|---|---:|---:|---|---:|---|---|")
for(const [group,g] of Object.entries(diagnostic.groups))lines.push(`|${group}|${g.n}|${g.normalAvailable}|${interval(g.normal)}|${g.superAvailable}|${interval(g.super)}|${g.precisionMet?"是":"否"}|`)
const coverage={allin:rows.filter(r=>r.allinOpponents>0).length,side:rows.filter(r=>r.sidePots>0).length,folded:rows.filter(r=>r.folded>0).length}
lines.push("",`固定样本覆盖：已全下对手 ${coverage.allin} 条、产生边池 ${coverage.side} 条、已有弃牌参与者 ${coverage.folded} 条。HU在已匹配全下后没有新的转牌行动点，研究没有伪造这种机会。`,"","### 牌面、深度与策略分层","","以下来自固定检验样本，分层只作诊断，不回流调参，也不进入报价。小分层的区间不作同时显著性结论。","","|分层|数量|自选数量|自选增量净收益 ± 近似95%半宽|","|---|---:|---:|---|")
for(const field of ["texture","depth","profile","count"]){for(const key of [...new Set(rows.map(r=>String(r[field])))].sort()){
 const subset=rows.filter(r=>String(r[field])===key),chosen=subset.filter(r=>r.chosen),s=math.summarize(values(chosen))
 lines.push(`|${field}=${tableText(key)}|${subset.length}|${chosen.length}|${interval(s)}|`)
}}
lines.push("","## 5. 他人先Roll的影响","","控制实验从手牌开始分配不同资本并重放同一合法轨迹，以精确匹配当前本人筹码、有效底池和有效未来筹码；没有中途充值。整体分支保留实际费用造成的资金变化。相应原始数据和摘要分别保存，不能把匹配条件下的结果叫作普适因果效应。","","|他人历史 / 本次档位|样本|匹配资金后的毛机会价值变化 BB ±95%半宽|含资金变化的整体变化 BB ±95%半宽|方向证据|","|---|---:|---|---|---|")
for(const [key,g] of Object.entries(history.groups))lines.push(`|${key}|${g.n}|${interval(g.conditional)}|${interval(g.overall)}|${g.evidence}|`)
lines.push("","### 实际应用的历史系数","","|本次档位:先前档位|估计β|多重比较校正区间|实际应用β|","|---|---:|---|---:|")
for(const [key,d] of Object.entries(historyFit.details)){
 const [kind,prior]=key.split(":");lines.push(`|${key}|${number(d.estimate,6)}|[${number(d.lower,6)}, ${number(d.upper,6)}]|${number(model.historyByKind[kind][prior],6)}|`)
}
lines.push("","历史修正跨零时应用0，表示没有足够证据另收费用，**不表示证明历史没有影响**。即使显式历史系数为0，对手付款减少可争夺筹码、或有人弃牌改变人数，也可能通过基础价影响后续报价；不存在机械的全桌第几次涨价。","","## 6. 连续顺序与停止","","四种策略使用同一初始样本和对应的立即正常出牌基线，起档相对本次实验起点，不由已有次数奇偶偷换。是否继续由可见牌策略、价格与真实筹码预算共同决定；没有把无限使用都做成正收益。","","|模式|样本|当前自选数|当前自选净增量 ±95%半宽|当前补偿 BB|当前平均Roll次数|","|---|---:|---:|---|---:|---:|")
for(const mode of ["normal","super","normal-super","super-normal"]){const s=read(`sequence-${mode}-summary.json`);lines.push(`|${mode}|${s.rows}|${s.chosen}|${interval(s.chosenNet)}|${number(s.meanCompensation)}|${number(s.meanRolls)}|`)}
lines.push("","## 7. 本次费用收支平衡扫描","",`独立 ${feeAudit.rows} 个起点，${feeAudit.available} 个有能力付正费用。只改变当前一次费用；后续价格模型参数固定，但未来报价仍随合法资金状态更新。扫描当前剩余筹码的0%、1%、2.5%、5%、10%、20%、40%、70%、90%，完整续局到结束，不丢弃负收益。`,"","每组两档九个费用点作 Bonferroni 正态近似诊断。表中 BB 为各手按余额比例支付费用的均值，过零区间属于这一比例收费政策的强制尝试平均净增益曲线，不是单一固定 BB 收费的精确根，也不能直接与公式平均报价比大小来判定合理性。线性插值不是按最佳私牌推算的价格，也不是每个玩家的精确愿付上限。自主选择有利局面的正式收益另见第3节。", "","|分组|档位|可付费起点|当前公式平均报价BB|扫描过零费用区间BB|线性插值BB|端点符号有校正置信支持|","|---|---|---:|---:|---|---:|---|")
for(const [group,g] of Object.entries(feeAudit.groups))for(const kind of ["normal","super"]){
 const value=g[kind],cross=value.crossings[0]
 lines.push(`|${group}|${kind}|${g.available}|${number(value.quotedMean)}|${cross?`[${number(cross.lowerFee)}, ${number(cross.upperFee)}]`:value.allNonpositive?"全部点估计非正":value.rightCensored?"扫描上限仍为正":"无清晰过零"}|${cross?number(cross.interpolatedFee):"—"}|${cross?.confidenceCertified?"是":"否"}|`)
}
lines.push("","完整九点曲线及非单调／右删失标记见 [break-even-summary.json](./break-even-summary.json)。未出现清晰区间时如实保留，不能把最高费用或最优中奖金额当成公允价格。")
lines.push("","## 8. 限制、失败条件与复现","","- 这是有限启发式对手与可达合成局面的研究；不承诺真实玩家收益或多人GTO，也没有模拟网络、思考耗时和真实客户端超时。","- 采用均值回归和统一公开价，不能恰好补偿每个私牌的价值。公共牌结构分层诊断和模型残差不能用总体均值置信区间代替。","- 强制操作付不起时原始收益记null，不计入可支付干预均值；自主选择路径仍保留完整结果，没有把付不起者的收益当零后宣称有利。","- 价格曲线只在已测试45个网格候选和独立复评中选择，不声称连续参数空间的全局最优。","- 后续任何根据本次最终数据调整参数的模型，都需要新种子的独立最终检验；不能继续复用本次holdout宣布通过。","", `复跑、单条重放和数据校验命令见 [研究程序说明](${programGuide})。原始数据索引、全部模型、校准与最终结果均保存在本目录，SHA256链见 artifacts.json。产品没有启用Roll，注册项、MCP、数据库与发布流程未改变。`,"")
if(fs.existsSync(path.join(out,"VALIDATION.md")))lines.push("测试、独立审阅及完整数据链执行记录见 [验证记录](./VALIDATION.md)。","")
function insertBefore(marker,content){const i=lines.indexOf(marker);if(i<0)throw new Error("Missing report marker: "+marker);lines.splice(i,0,...content,"")}
const probabilities={}
const exact=["### 精确概率与补偿恒等式","","以下是精确组合概率，不是模拟EV或定价比例。固定保留一张K、替换非K；对手最初随机持牌、无人另行操作、不开公共牌，命中另外3张K之一就停止。D为牌组总数、N=6、U=D−2、L=D−2N，剩余目标数S服从Hypergeom(U,3,L)。条件于S=s，普通失败率1−s/L，超级失败率C(L−s,3)/C(L,3)。连续a次普通、b次超级的累计命中率为1−ΣPr(S=s)×(1−s/L)^a×[C(L−s,3)/C(L,3)]^b。","","|牌组|一次普通|三次普通|一次超级|三次超级|","|---|---:|---:|---:|---:|"]
for(const deck of [52,32]){const values=[[1,0],[3,0],[0,1],[0,3]].map(([normal,superRoll])=>math.repeatedTargetProbability(deck,6,3,normal,superRoll));probabilities[deck]=values;exact.push(`|${deck}|${values.map(v=>number(100*v,4)+"%").join("|")}|`)}
exact.push("","补偿总额严格等于C：m名合资格对手各获floor(C/m)，余数C mod m按庄家左侧起的资格顺序各加1。费用不进普通底池；先普通派彩，再释放冻结补偿。最低收费、至少留一筹码、等权归一化max-min目标是公开设计取舍；全文EV与置信区间是有限模拟估计，不能与精确概率混称。")
fs.writeFileSync(path.join(out,"probability-regression.json"),JSON.stringify({conditions:"Six players, retained K, three other K targets; stop on first hit, no other actions or board advances",columns:["normal1","normal3","super1","super3"],probabilities},null,2)+"\n")
insertBefore("## 2. 抽样、策略与价格选择",exact)
const nearby=["### 附近候选与价格区间","","下表为独立复评的离散候选。尺度范围是已试候选范围，不是统计意义的公允价格置信区间；若最终门槛失败，这些候选均不能称为可上线区间。固定公开条件可直接代入各模型报价。","","|曲线|增长参数|尺度|全部机会保留增量BB ±95%半宽|当前补偿BB|归一化max-min分数|","|---|---:|---:|---|---:|---:|"]
for(const c of selection.refined)nearby.push(`|${c.model.curve}|${c.model.growth}|${c.model.scale}|${interval(c.allOpportunitiesNet)}|${number(c.meanCompensation)}|${number(c.balanceScore)}|`)
if(fs.existsSync(path.join(out,"pricing-diagnostics.png")))nearby.push("","![独立候选比较与次数系数](./pricing-diagnostics.png)")
insertBefore("## 3. 正式固定样本检验",nearby)
insertBefore("## 3. 正式固定样本检验",["抽样权重与计算预算：","","54个主要分组等权；每组深度10/25/50/100/250/500/1000/2500 BB轮换，均匀／短筹码／深筹码／已有全下四种形状轮换，四种同类对手加混合对手轮换。单挑已全下后无行动点的形状以合法均匀起点替代。它是公开的研究分布，不是从真人数据拟合的使用分布。","","起点由公开check/call及每个更早阶段至多一次公开尺度加注的合法暖场轨迹获得；既有Roll按覆盖规则安排，不能称为自然玩家先手行为分布。四类下注／停止策略用于完整续局。每起点每条分支完成一次随机结局，未用无限内层求解；可见牌机会按全部未知牌及随机三张的组合分布计算有限特征。NNLS最多80轮，逻辑动作保护上限20000，整手bootstrap400次、种子77121；动作上限触发会失败，不把截断收益纳入研究。全部参数与种子派生代码随源码指纹保存。"])
const distributions=["### 完整续局增量与补偿分布","","以下为当前自选Roll者的经验分位数，单位BB；补偿是本行动点全部新费用，等额确权给对手。它与付款方配对增量不是同一个随机变量，不相加解释为总福利。","","|指标|5%|25%|中位数|75%|95%|","|---|---:|---:|---:|---:|---:|"]
for(const [label,field] of [["付款方完整续局增量","voluntary"],["当前行动点补偿","paid"],["付款方剩余手牌全部费用","totalPaid"]])distributions.push(`|${label}|${[.05,.25,.5,.75,.95].map(p=>number(quantile(selectedRows.map(r=>r[field]),p))).join("|")}|`)
distributions.push("","最差五条固定检验样本，保留失败而不当作模型最优价。可用表中的完整ID执行单条重放：","","|样本ID|筹码深度BB|策略|进入次数|本行动Roll数|当前费用BB|增量净收益BB|","|---|---:|---|---:|---:|---:|---:|")
for(const r of [...selectedRows].sort((a,b)=>a.voluntary-b.voluntary).slice(0,5))distributions.push(`|${r.id}|${r.depth}|${r.profile}|${r.count}|${r.rolls}|${number(r.paid)}|${number(r.voluntary)}|`)
insertBefore("## 4. 精度诊断与覆盖",distributions)
if(fs.existsSync(path.join(out,"independent-stats.json"))){
 const independent=read("independent-stats.json"),content=["### 独立统计复核","",`Python／NumPy ${independent.numpy} 单独实现分组固定权重、整手重采样，${independent.generator}种子${independent.seed}、${independent.repetitions}次。它没有参与选参，也不替换原先冻结的JS检验；两种实现的均值与标准误一致，有限bootstrap区间存在正常的抽样差异。`,"","|指标|平均增量BB|独立整手bootstrap 95%区间BB|","|---|---:|---|"]
 for(const [key,s] of Object.entries(independent.statistics))content.push(`|${key}|${number(s.mean)}|[${number(s.bootstrapLower)}, ${number(s.bootstrapUpper)}]|`)
 insertBefore("## 4. 精度诊断与覆盖",content)
}
const stops=["### 当前行动点的实际停止位置","","次数为进入行动点的本手累计数加本行动点新增数；包括选择立即停止的机会。这里只报告停止位置，未把停止原因推断成资金不足或理性最优。不同策略的参数及深度分层另列，有限策略不保证每一个次数分层都盈利。","","|行动点结束时累计次数|机会数|当前自选数|自选净增量BB ±95%半宽|","|---|---:|---:|---|"]
for(const [label,test] of [["0",v=>v===0],["1",v=>v===1],["2",v=>v===2],["3",v=>v===3],["4",v=>v===4],["5–9",v=>v>=5&&v<=9],["10+",v=>v>=10]]){
 const subset=rows.filter(r=>test(r.count+r.rolls)),chosen=subset.filter(r=>r.chosen)
 stops.push(`|${label}|${subset.length}|${chosen.length}|${interval(math.summarize(values(chosen)))}|`)
}
insertBefore("## 7. 本次费用收支平衡扫描",stops)
const sequenceReference=raw("sequence-normal"),referenceById=new Map(sequenceReference.map(r=>[r.id,r]))
const modeComparison=["### 四种全桌后续模式的配对比较","","上表的每种模式都使用自身的未来模式作为正常出牌基线，且自选者集合可能不同，不能据其条件增量直接给模式排名。模式约束同时作用于全桌参与者，不是只改变当前付款方而固定其他人的策略。下表改为同一合法起点、全部机会的最终余额配对差，以“从本起点全桌只用普通Roll”的路径为参照；先前已发生的覆盖历史相同。它包括停止、未来下注、全部费用与补偿，仅为独立诊断，不回流选价或充当新的正式门槛，也不识别付款方个人顺序的纯粹因果效应。","","|模式|整手配对数|相对普通模式最终余额差BB ±95%半宽|单手差值为负比例|","|---|---:|---|---:|"]
for(const mode of ["normal","super","normal-super","super-normal"]){
 const sequence=mode==="normal"?sequenceReference:raw("sequence-"+mode),deltas=sequence.map(r=>{const ref=referenceById.get(r.id);if(!ref||r.seed!==ref.seed||r.count!==ref.count||JSON.stringify(r.x)!==JSON.stringify(ref.x))throw new Error("Sequence initial states differ: "+r.id);return r.ending-ref.ending})
 modeComparison.push(`|${mode}|${deltas.length}|${interval(math.summarize(deltas))}|${number(100*deltas.filter(v=>v<0).length/deltas.length,2)}%|`)
}
insertBefore("## 7. 本次费用收支平衡扫描",modeComparison)
if(fs.existsSync(path.join(out,"personal-sequence-summary.json"))){
 const personal=read("personal-sequence-summary.json"),content=["### 只改变本人模式，对手保持自适应","",`另用 ${personal.rows} 个独立合法起点，固定对手的下注／停止风格及档位选择函数，仅改变当前付款方的后续允许模式；对手的Roll档位模式始终为adaptive（两档自主比较），仍按实际状态正常反应，下注风格保留同类与混合分配。参考路径是本人本手余下不再Roll，因而测量整套个人策略价值，区别于正式检验“现在正常行动，以后保留机会”的单次选择价值。未用于选价。每个汇总对5个模式对照使用Bonferroni正态近似区间（z=${number(personal.z,6)}），不宣称所有次数分层联合覆盖。`,"","|本人模式|起点数|相对本人不再Roll的净增量BB ±校正半宽|本手余下费用BB|本手余下Roll次数|单手负增量比例|","|---|---:|---|---:|---:|---:|"]
 for(const [mode,s] of Object.entries(personal.byMode))content.push(`|${mode}|${s.n}|${interval(s.net)}|${number(s.meanFees)}|${number(s.meanRolls)}|${number(100*s.lossFraction,2)}%|`)
 content.push("","按进入行动点时本人次数分层；停止众数是本行动点结束时的累计次数，不是永久停止或最优停止。先前实际付费Roll可能改变牌力，不能把这些分层差异全归因于加价。","","|进入次数|本人模式|起点数|整手增量BB ±校正半宽|本行动点停止次数众数|","|---:|---|---:|---|---:|")
 for(const [count,modes] of Object.entries(personal.byCount))for(const [mode,s] of Object.entries(modes)){if(mode==="none")continue;const modal=Object.entries(s.stops).sort((a,b)=>b[1]-a[1])[0]?.[0];content.push(`|${count}|${mode}|${s.n}|${interval(s.net)}|${modal??"—"}|`)}
 insertBefore("## 7. 本次费用收支平衡扫描",content)
}
const residuals=["### 基础估值迁移残差诊断","","仅使用固定检验中本人次数为0且可支付的强制操作。预测值是未缩放的训练初始化基础估值；观测代理是实际收费下的完整续局增量再加回本次费用。后者包含未来下注与Roll，且费用改变了资金和策略，不能视为零费下真实机会价值。单次随机结局还带来大量噪声，因此MAE/RMSE不是精确EV预测误差；本研究未单独识别每个私牌的真实EV误差。均值残差和分组均值精度也不能代替它。","","|档位|样本|观测代理−初始化预测的均值BB ±95%半宽|MAE BB|RMSE BB|","|---|---:|---|---:|---:|"]
for(const kind of ["normal","super"]){
 const errors=rows.filter(r=>r.count===0&&typeof r[kind]==="number"&&Number.isFinite(r[kind])).map(r=>{const c=(model.cells[r.group]??model.coefficients)[kind];return r[kind]+r[kind==="normal"?"normalFee":"superFee"]-c.reduce((s,v,i)=>s+v*r.x[i],0)})
 residuals.push(`|${kind}|${errors.length}|${interval(math.summarize(errors))}|${number(math.mean(errors.map(Math.abs)))}|${number(Math.sqrt(math.mean(errors.map(v=>v*v))))}|`)
}
insertBefore("## 5. 他人先Roll的影响",residuals)
const required=Object.values(diagnostic.groups).map(g=>Math.max((inference.diagnosticZ*g.normal.sd/g.targetNormal)**2*g.n/g.normalAvailable,(inference.diagnosticZ*g.super.sd/g.targetSuper)**2*g.n/g.superAvailable))
insertBefore("## 5. 他人先Roll的影响",["### 预算与方差","",`按最终观测方差、相同平均报价目标及当前可付费比例折算总起点预算，每组达到两档精度所需起点数的中位数约 ${Math.ceil(quantile(required,.5)).toLocaleString("en-US")}，范围约 ${Math.ceil(Math.min(...required)).toLocaleString("en-US")}–${Math.ceil(Math.max(...required)).toLocaleString("en-US")}。这不是新的通过标准或保证，方差、可付费比例与报价均仍有估计误差；这里只解释深筹码混合对局为何可能在32,768上限仍证据不足。不能为了让这个数变小而把收费抬高。`])
if(fs.existsSync(path.join(out,"seed-audit.json"))){const audit=read("seed-audit.json");insertBefore("## 3. 正式固定样本检验",["训练／固定检验隔离审计：","",`- 训练 ${audit.trainRows} 条，固定检验 ${audit.fixedRows} 条；同组种子内部重复分别 ${audit.trainDuplicateGroupSeeds}／${audit.fixedDuplicateGroupSeeds}，跨集交集 ${audit.crossSplitGroupSeedIntersections}。候选校准刻意共用随机数，不属于训练／最终检验混用。`,`- 跨阶段按牌组、原始入座人数和初始种子识别底层手牌，训练／固定各自重复 ${audit.trainDuplicateUnderlyingHands}／${audit.fixedDuplicateUnderlyingHands}，两集交集 ${audit.underlyingHandIntersections?.["train:fixed"]??"未计算"}；固定集全部32位种子重复 ${audit.fixedGlobalSeedReuses}。训练中有 ${audit.trainGlobalSeedReuses} 次跨不同牌组／人数的种子复用，未把它们冒充相同手牌或最终检验数据。`,""])}
if(fs.existsSync(path.join(out,"cluster-audit.json"))){const clustered=read("cluster-audit.json");insertBefore("## 5. 他人先Roll的影响",["### 补样中的重复种子与整手聚类复核","",`自适应全部数据发现 ${clustered.duplicates.length} 个组内重复32位种子簇；未删除或悄悄重抽。正式固定2048/组没有这些重复，正式检验仍只用固定样本。另保存 [cluster-audit.json](./cluster-audit.json)，按组内实际手牌种子聚类计算完整均值的稳健标准误，使用G/(G−1)修正、原Bonferroni z和原收费误差目标，${clustered.precisionGroups}/${clustered.totalGroups} 组达标，未覆盖原冻结结果或改动价格。`,"","上方精度表保留原冻结的正态近似诊断，重复簇复核是事后质量检查，不是从多个区间中挑选通过者。两种诊断均不能认证当前模型。下一轮需扩大种子／随机状态空间并在最终抽样前检查独立手牌标识；本次保留全部重复记录及其ID。"])}
if(fs.existsSync(path.join(out,"replay-verification.json"))){const replay=read("replay-verification.json");insertBefore("## 5. 他人先Roll的影响",["### 原始资本与逐步账本样例","",`正式样本 \`${replay.id}\` 用原冻结内核重放，与原始结果逐字段一致。${replay.branches}个状态分支（含起点暖场，${replay.completedBranches}个完成结算）共${replay.traceSteps}条状态记录全部保持原始资本守恒；${replay.frozenPositiveSteps}条记录仍有正的冻结补偿，${replay.settledBeforeReleaseSteps}条已派彩但尚未释放。见 [逐步资金账本](./audit-trace.jsonl) 和 [重放校验](./replay-verification.json)。这些审计信息只属于合成研究观测器，不交给策略。`])}
if(fs.existsSync(path.join(out,"acceleration-manifest.json")))lines.push("","计算实现说明：完整批次检查点后使用可见牌力纯函数的精确数值缓存继续。冻结内核、报价、种子、样本上限和正式2048/组未变。768组完整配对结果SHA一致；恢复回归验证新增行与原内核一致。额外执行路径、模型和策略指纹以及旧批次前缀校验见 acceleration-manifest.json 和 memoization-parity.json。")
if(fs.existsSync(path.join(out,"multi-history-final-summary.json"))){
 const multi=read("multi-history-final-summary.json")
 const content=["### 多人先后操作的独立控制实验","",`额外 ${multi.rows} 条档位干预结果（每个起点两档），3–10人、两种牌组和三阶段。两至三名先手依次操作，覆盖单次、连续混档及最后一名先手弃牌；从入座时的初始资本求解资金匹配，不中途充值。未用于拟合历史系数；仅作独立诊断，不因该样本的正负点估计追加价格项。两档共享起点，但每行只聚合一种干预，未把两档当成独立观察来缩小区间。`,"","|先手模式 / 本次档位|起点数|匹配资金后机会价值变化BB ±95%半宽|含真实资金变化的整体变化BB ±95%半宽|","|---|---:|---|---|"]
 for(const [key,g] of Object.entries(multi.groups))content.push(`|${tableText(key)}|${g.n}|${interval(g.conditional)}|${interval(g.overall)}|`)
 content.push("","分组多重比较未作整体显著性宣称。精确匹配的是目标玩家当前报价使用的公开资金与次数；不同初始资本、冻结补偿和先手牌力仍是受控历史的一部分。无法据此识别所有真人行为下纯粹的历史因果效应。")
 insertBefore("## 6. 连续顺序与停止",content)
}
insertBefore("## 6. 连续顺序与停止",["历史控制实验的起点只用25/100/500/2500 BB和均匀初始筹码，目标玩家此前本人次数为0；主研究另覆盖其他深度、悬殊筹码与本人次数。不能把条件历史结果外推成这些维度上的精确因果结论。整体分支按真实余额与资格执行先手计划，付不起后停止；表中模式指安排的先手策略，不保证整体分支实际完成每次操作。资金匹配分支才严格完成全部指定序列。"])
if(fs.existsSync(path.join(out,"fee-audit.png")))insertBefore("## 8. 限制、失败条件与复现",["![只改变当前费用的独立扫描](./fee-audit.png)"])
if(fs.existsSync(path.join(out,"revision-candidate.json"))){
 const revision=read("revision-candidate.json")
 lines.push("","## 9. 未通过门槛后的模型修订","",`保留原模型与原最终数据，另存 [revision-candidate.json](./revision-candidate.json)。新基础系数改用 ${revision.trainingRows} 个零本次费用、允许完整未来Roll／下注的起点拟合，包含负结果；替代原来关闭未来Roll的初始化。曲线、尺度及历史规则暂保留，未重新宣称最优。`,"","这批独立费用扫描数据现在明确作为新版本训练，未用于原版本选参；新模型状态是 **未验证，仅供下一轮研究**。原holdout不能复用为新模型的独立检验。必须使用新训练／校准与未触及的最终种子，继续保持本次净收益和精度门槛。","","精度不足不等于已证明某个具体价格错误；修订不通过抬高费用扩大容许误差，也不保证解决方差。下一轮应按深度固定权重分层、增加每个起点的内层续局以降低均值估计噪声，并重新报告预算内是否达标，不能只放宽断言。")
}
fs.writeFileSync(path.join(out,"REPORT.md"),lines.join("\n"))
seal(out)
process.stdout.write(JSON.stringify({report:path.resolve(out,"REPORT.md"),rows:allRows.length,fixedRows:rows.length,fullyValidated:valid})+"\n")
