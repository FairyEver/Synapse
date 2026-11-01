# Roll 牌离线研究

仅研究程序；不注册产品能力，不写业务数据库，不启动应用或网络服务。默认引擎固定读取 Git 提交 `ea48b82ce` 的纯扑克模块，当前工作区的生产代码修改不会混入实验。

研究与研究检查要求本地已有该历史提交对象；可用 `git cat-file -e ea48b82ce^{commit}` 核对。程序不自动联网获取。检查使用独立Vitest配置，不进入默认产品测试发现范围，避免浅克隆CI依赖旧研究提交或意外执行研究CLI。

## 运行

在仓库根目录执行：

```bash
pnpm --filter @synapse/server exec vitest run --config test/poker-roll-research/vitest.config.mts --maxWorkers=1
pnpm --filter @synapse/server exec tsc -p test/poker-roll-research/tsconfig.json
node server/test/poker-roll-research/run.cjs all --samples 2048 --max-samples 32768 --calibration-samples 32 --history-samples 512 --workers 8 --out work/poker-roll-research-reproduction
node server/test/poker-roll-research/valuation.cjs --out work/poker-roll-research-reproduction --samples 512 --workers 2
node server/test/poker-roll-research/multi-history.cjs --out work/poker-roll-research-reproduction --samples 128 --workers 2
node server/test/poker-roll-research/personal-sequence.cjs --out work/poker-roll-research-reproduction --samples 256 --workers 2
node server/test/poker-roll-research/revision.cjs work/poker-roll-research-reproduction
node server/test/poker-roll-research/audit.cjs work/poker-roll-research-reproduction
node server/test/poker-roll-research/cluster-audit.cjs work/poker-roll-research-reproduction
node server/test/poker-roll-research/report.cjs work/poker-roll-research-reproduction
node server/test/poker-roll-research/verify.cjs work/poker-roll-research-reproduction
```

短流程检查可用 `pilot --samples 64 --workers 6 --out work/poker-roll-pilot`。pilot 不是完整验证，不能用于发布价格。

完整批次已保存且原研究进程已经停止时，可用 `node server/test/poker-roll-research/resume.cjs --out RESULT_DIRECTORY --workers 8` 继续。禁止与原进程并发写同一目录。该路径只为可见牌力纯函数增加精确缓存；原内核文件不变，额外保存源码、模型、策略拟合与旧数据前缀指纹。768组完整配对续局的原／缓存结果哈希一致，恢复回归也核对新增行、固定样本和预算。原始命令仍可从头复现相同数值。

重放一条最终检验样本：

```bash
node server/test/poker-roll-research/replay.cjs --out docs/superpowers/research/2026-11-01-poker-roll --id final-holdout:standard52:6:flop:0
```

加 `--trace PATH.jsonl` 可另外保存该起点所有配对分支的逐步资金账本：原始资本、正常投入、可用筹码、冻结补偿、各人已付费用、引擎锚点及释放顺序。观测器只读合成研究状态，数据不交给策略；逐字段回归确认不改变续局结果。输出必须是不存在的新文件，避免覆盖原始数据。

训练重放使用原始探索价格；其他重放默认使用 `recommended-model.json`，可用 `--model FILE` 指定某一候选模型。顺序比较重放还需指定 `--mode normal-super` 或 `--mode super-normal`。重放不修改结果目录。

## 模型与边界

- 使用固定引擎的下注、发牌、判胜及边池。独立账本保存原始资本；仅研究适配器把纯引擎的资本断言锚点减去已转入冻结补偿的费用。每次转换都独立校验原始资本、冻结资产和牌量，没有删除或放宽原断言。
- 固定引擎的判型结果可缓存；快速可见牌特征只用于有限策略，经过与固定判型器的随机对照测试，不参与判胜。
- 普通先指定旧牌后随机替换；超级先指定后抽随机三张，再由本人可见牌策略选一张。全部强制操作结果（包括负收益）进入估值，绝不挑中奖样本拟合。
- 报价仅取公开财务特征、阶段、人数、共享个人次数和他人公开 Roll 历史。牌值与私人回收牌历史只供本人决策，不能进入价格。
- 本人在当前公共牌阶段、其他人尚未取牌时确定放回的牌，按真实剩余池加权；新的公共牌阶段或他人 Roll 后，有限策略保守地放弃这份“确定在池中”的知识。它不是完整贝叶斯最优记牌策略。
- 四种下注／停止策略及其参数保存在 `manifest.json`。策略是有限启发式；松凶策略包含风险偏好。研究没有求解多人 GTO，也不声称模拟器代表所有真人策略。
- 同一起点比较立即正常出牌（以后仍可 Roll）、强制普通／超级、当前自主连续 Roll，均续局到正常结束。策略选牌不使用实际检验世界的对手牌或未来牌。
- 公共牌共同随机数采用全牌组独立优先序，各分支仅保留合法剩余牌。这样降低方差，但不强制发出分支中已经被抽走的同一张牌。
- 个人次数加价严格增长，实际报价也受有效筹码变化影响；不能把“次数系数增长”说成所有真实轨迹的绝对价格必然次次提高。
- 逻辑对局不模拟网络延迟、人类思考耗时或真实 600 秒超时；停止由策略与真实筹码预算约束，不依靠超时替代付费。纯逻辑研究不等于真实客户端验收。

## 统计设计

1. 训练阶段只做一次干预并关闭未来 Roll，仍完成后续正常下注至结算，作为基础估值／私人机会预测的启发式初始化；完整多次未来 Roll 在校准和最终检验中开放。初筛 45 个模型（3 族曲线×3 个斜率×5 个尺度）。全部负样本保留，不按具体牌面收费。
2. 初筛后用独立 `calibration-refinement` 种子复评最多五个候选，每族优先保留一个，再按等权归一化 max-min 选择付款方保留价值与本行动点新补偿的折中。没有使用率目标。
3. 独立历史校准生成当前公开资金精确匹配的合法重放。额外资本来自手牌开始，不是中途充值；单独保存不补足初始资本的整体影响分支。对四项历史修正做 Bonferroni 检验；跨零意味着证据不足，不能说已经证明无影响。
4. 最终固定每组最初 2,048 个样本用于正式总体检验，组权重不被补样改变。bootstrap 按组固定重采样，保持整手配对关系。整体、当前自选者及两档自选者的正收益门槛均须通过。
5. 追加到最多 32,768/组的数据仅用于分组精度诊断；区间按每组两档和预定观察次数作 Bonferroni 正态近似校正，不宣称54组联合95%覆盖。重尾和有限策略仍限制解释。
6. 报价误差目标用于分组均值的 Monte Carlo 误差，不是每一手牌的获胜保证或个体价格误差。报告另外给出牌面结构、筹码深度、策略和次数分层结果。

## 文件

- `manifest.json`：配置、源文件 SHA256、引擎 ref／SHA256、策略参数。
- `fitted.json`、`recommended-model.json`、`coefficients.csv`：完整系数，JSON 为计算的权威精度。
- `selection.json`、`history-fit.json`：候选选择和历史修正依据。
- `fixed-holdout-summary.json`、`bootstrap.json`：正式固定样本检验。
- `final-summary.json`：包括自适应补样的精度诊断，不能替代正式固定检验。
- `*-index.json`、`*.jsonl.gz`：按组保存的原始配对结果和哈希。`ordinal` 保留原始全局顺序；JSON `null` 的强制干预收益表示付不起，不能当成零收益。
- `sequence-*-summary.json`：普通、超级、先普通后超级、先超级后普通，使用相同初始样本。
- `personal-sequence-summary.json`：只改变目标玩家顺序，对手均保持自适应策略；以该玩家本手余下不再Roll为完整策略基线，独立于正式“现在正常行动、以后保留机会”的门槛。逐步种子与自适应原续局完全相同，仅按座位选模式。
- `multi-history-final-summary.json`：独立多人先手控制实验；2–3名先手依次单次／连续混档，并覆盖最后先手弃牌。当前资金从入座资本精确匹配，不中途充值；未用于调参。单挑不存在两名先手之后再轮到第三人的行动点，故仅覆盖3–10人。
- `REPORT.md`：公式、报价例子、分层结果、失败条件、限制及最终结论。

冻结补偿仅在手末释放；当前行动点补偿与后来另一次行动的费用分开。`paid` 是当前行动点新付费用，`totalPaid` 是本手剩余路径总支出。`voluntary` 是相对立即正常出牌的完整续局净增益，既不是绝对赢池率，也不是金融投资收益。

独立费用扫描固定未来规则参数，仅改变本次费用为各手当前余额的比例。表中的 BB 是不同局面费用的平均值，过零区间不是某个统一固定 BB 收费的精确根；也不能仅凭它与公式平均报价的大小关系判断公式合理性。

若原模型未通过冻结门槛，`revision.cjs` 保留原模型与全部失败结果，另存 `revision-candidate.json`：改用零本次费用且开放完整未来 Roll 的样本重拟合基础系数。它明确成为新版本的训练，不能再拿旧最终检验认证；新版本尚未检验，不是推荐上线价格。精度不足本身不证明原报价错误，该修订也不通过抬价放宽精度目标。

可选图形使用本机已有 matplotlib（不安装新依赖）：`python3 server/test/poker-roll-research/plot.py RESULT_DIRECTORY`，再运行报告生成器将图纳入哈希封存。

独立统计复核可使用本机已有NumPy：`python3 server/test/poker-roll-research/independent-check.py RESULT_DIRECTORY`。它只重采样固定检验整手，PCG64种子和1000次预算随结果保存，不改变原模型、检验门槛或选参。
