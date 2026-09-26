#!/usr/bin/env node
/**
 * 「页面定义混进契约」这一类错，**后果到底是什么**——只读实测。
 *
 * 用法（必须走受控入口，见 docs/conventions.md 第 8 条）：
 *   ./smoke/with-portal-token.sh node tools/sample/probe-isarchived.mjs \
 *     | grep -v '^\[portal-token\]' > tools/sample/isarchived-probe.json
 * （`grep -v` 是必须的：wrapper 会往 stdout 打一行「已取得 token（长度）」的提示，
 *   不过滤就会混进 JSON 里，`require` 直接报 Unexpected token 'p'。）
 *
 * 为什么单独一个脚本：抽样装置能证明「`isArchived` 在页面上没有控件、不该出现在契约里」，
 * 但证明不了「拨了它会怎样」。而"拨了它会怎样"正是**这条发现值不值得修**的全部依据——
 * 不实测的话，这一条只是"契约里多了一个参数"，修不修都说得过去。
 *
 * 测的是什么：同一个接口 `/org/hrAttendanceSheet/page` 发三次 GET，
 * 只差 `isArchived`（=1 / =0 / 不带），比较返回的 `total` 与首批 id。
 *
 * 实测结论（2026-09-20，测试环境）：
 *   isArchived=1   → 200 SUCCESS，total 105，ids 153,149,148
 *   isArchived=0   → 200 SUCCESS，total 118，ids 154,153,152
 *   不带 isArchived → 200 SUCCESS，total 118，ids 154,153,152
 * 也就是：**改成 0 不报错，而且和"不传"完全等价**——AI 只要把契约里这个参数拨一下，
 * 就会在没有任何信号的情况下拿到另一批数据（考勤档案 105 条 vs 考勤表 118 条）。
 *
 * 边界：只发 GET，不写任何东西；只对测试环境；token 由 with-portal-token.sh 注入到环境变量，
 * 本脚本不打印、不落盘 token。
 */

const BASE = process.env.PORTAL_BASE_URL
const TOKEN = process.env.PORTAL_TOKEN
const TENANT = process.env.PORTAL_TENANT_ID

if (!BASE || !TOKEN || !TENANT) {
  console.error('缺 PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID。请用 smoke/with-portal-token.sh 跑本脚本。')
  process.exit(2)
}

/** module-type 用**规则表**对「考勤档案」这一页推出来的值（浏览器在这一页发的也是它）。 */
const MODULE_TYPE = 11
const LIST_PATH = '/admin-api/org/hrAttendanceSheet/page'
const STYLE = 'order=&orderField=&pageNo=1&pageSize=5'

const get = async (label, query) => {
  const res = await fetch(`${BASE}${LIST_PATH}?${query}`, {
    headers: {
      'tenant-id': TENANT,
      token: TOKEN,
      'module-type': String(MODULE_TYPE),
      'Accept-Language': 'zh-CN',
      Accept: 'application/json, text/plain, */*',
    },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON 就留 null */ }
  const data = json && json.data
  const list = data && (Array.isArray(data.list) ? data.list : null)
  return {
    label,
    query,
    status: res.status,
    ret: json && json.ret,
    code: json && json.code,
    条数: data && data.total,
    本页行数: list ? list.length : null,
    // 只记稳定标识，不带业务内容
    前三个id: list ? list.slice(0, 3).map((r) => r && r.id) : null,
  }
}

const main = async () => {
  const results = []
  for (const [label, query] of [
    ['isArchived=1（考勤档案页发的）', `${STYLE}&isArchived=1`],
    ['isArchived=0（契约允许 AI 拨的值）', `${STYLE}&isArchived=0`],
    ['不带 isArchived（考勤表页发的）', STYLE],
  ]) results.push(await get(label, query))

  const by = Object.fromEntries(results.map((r) => [r.label.split('（')[0], r]))
  const same = (a, b) => a.条数 === b.条数 && JSON.stringify(a.前三个id) === JSON.stringify(b.前三个id)
  console.log(JSON.stringify({
    说明: 'isArchived 的后果实测：只读 GET，测试环境。用来判断"页面定义混进契约"这一类错值不值得修。',
    环境: BASE,
    接口: LIST_PATH,
    moduleType: MODULE_TYPE,
    结果: results,
    判读: {
      'isArchived=0 与"不带"是否等价': same(by['isArchived=0'], by['不带 isArchived']),
      'isArchived=0 与 isArchived=1 是否等价': same(by['isArchived=0'], by['isArchived=1']),
      后果: same(by['isArchived=0'], by['不带 isArchived']) && !same(by['isArchived=0'], by['isArchived=1'])
        ? '拨一下 isArchived 会静默换成另一批数据：不报错、不提示，条数从 105 变 118。'
        : '本次实测没有复现出"静默换数据"，请重新核对上表。',
    },
  }, null, 2))
}

main().catch((error) => { console.error('PROBE FAILED:', error.message); process.exit(1) })
