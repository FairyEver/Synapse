import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPortalHttp } from '../src/http/client.js'

/**
 * 「SDK 到底把哪些头发出去了」——不查内存里的 header bag，查**线路上收到的**。
 *
 * 为什么要有这一层：axios 的 header bag（测试里 adapter 收到的 `config.headers`）
 * 与真正发出去的头**不是一回事**，`toJSON()` 会把值为 `undefined` 的槽位丢掉
 * （`node_modules/axios/lib/core/AxiosHeaders.js`）。只验 bag 会得出
 * 「多了一个 Content-Type」这种结论，而线路上根本没有它。
 *
 * 这里起一个本机 HTTP 服务器（`127.0.0.1` + 随机端口）读 `rawHeaders`，
 * 是唯一能区分「bag 里有个空槽位」与「真的多发了一个头」的办法。
 *
 * 已实测结论（2026-09-20）：
 * 1. 默认实例（`platform`）的 **GET 线路上没有 Content-Type**，与浏览器基准一致
 *    （`baseline/assignment-list.browser.json` / `attendance-archive-sheet.browser.json`
 *    的 headers 里都没有它）。所以「SDK 在 GET 上多发一个头」是**不成立**的。
 * 2. 那个空槽位**不是没有后果**（2026-09-20 已修）：`src/http/client.ts` 曾把「axios 已合并的
 *    bag」展开在最后（`...existing`），而该 bag 里带着 axios 自己的
 *    `'Content-Type': undefined`（`axios/lib/defaults/index.js:169`），于是
 *    `buildHeaders({ extraHeaders })` 声明的 Content-Type 会被覆盖掉 ——
 *    `zhdj-cms` / `zhdj-cms-lay` / `zhdj-app-lay` / `platform-mall-mes` 四个实例
 *    发的是 axios 按 body 类型兜的 `application/json`，而不是画像里声明的那个
 *    （`src/context/README.md:108` 当时是一句空话）。
 *    修法是在展开前滤掉 `undefined`/`null`：那四个实例声明的值出现在线路上，
 *    而默认实例的线路**一个字都没变**。下面最后一条用例锁的就是修好之后的行为。
 */

const received: Array<{ method: string; headers: IncomingHttpHeaders; raw: string }> = []

let server: ReturnType<typeof createServer>
let baseUrl: string

beforeAll(async () => {
  server = createServer((req, res) => {
    received.push({
      method: String(req.method),
      headers: req.headers,
      raw: JSON.stringify(req.rawHeaders),
    })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function http () {
  return createPortalHttp({
    baseUrl,
    credential: { token: 'tk-test', tenantId: 1 },
  })
}

describe('线路上收到的请求头', () => {
  it('默认实例的 GET 不带 Content-Type（与浏览器一致）', async () => {
    await http().get('/admin-api/probe/get')

    const hit = received.at(-1)!
    expect(hit.method).toBe('GET')
    // 断言的是「这个头不在线路上」，不是「它的值是空的」——后者在 bag 里成立、在线路上没意义
    expect(Object.keys(hit.headers)).not.toContain('content-type')
    expect(hit.raw).not.toContain('Content-Type')
  })

  it('默认实例的 POST 带 application/json —— 这是 axios 按 body 类型兜的，不是 SDK 发的', async () => {
    await http().post('/admin-api/probe/post', { a: 1 })

    const hit = received.at(-1)!
    expect(hit.method).toBe('POST')
    expect(hit.headers['content-type']).toBe('application/json')
  })

  it('GET 与 POST 的共同部分：SDK 自己的四个头 + 浏览器也有的 Accept', async () => {
    await http().get('/admin-api/probe/get')

    const hit = received.at(-1)!
    expect(hit.headers['tenant-id']).toBe('1')
    expect(hit.headers.token).toBe('tk-test')
    expect(hit.headers['accept-language']).toBe('zh-CN')
    // axios 的默认 Accept 与浏览器 XHR 的默认值逐字符相同，所以基准里也有它
    expect(hit.headers.accept).toBe('application/json, text/plain, */*')
  })

  it('调用方不能用任意大小写覆盖绑定的 token/tenant-id，但其他头会保留', async () => {
    await http().get('/admin-api/probe/get', {
      headers: {
        TOKEN: 'attacker-token',
        'TENANT-ID': '9999',
        'X-Request-Trace': 'trace-1',
      },
    })

    const hit = received.at(-1)!
    expect(hit.headers.token).toBe('tk-test')
    expect(hit.headers['tenant-id']).toBe('1')
    expect(hit.headers['x-request-trace']).toBe('trace-1')
  })

  it('画像声明的 Content-Type 真的发出去了（曾经发不出去——被 axios 的空槽盖掉）', async () => {
    // zhdj-cms.js:15-17 在 axios.create 里声明了表单式 Content-Type，
    // http-instance.ts 也照着记进了 extraHeaders。
    //
    // 这条断言曾经锁的是**缺陷存在**（线路上拿到的是 axios 兜底的 application/json）：
    // 成因是 `src/http/client.ts` 把 axios 已合并的 bag 展开在最后，而那个 bag 里
    // 带着 `'Content-Type': undefined`，把画像声明的值盖掉了。
    // 修法是在展开前滤掉空槽——于是「画像声明的头生效」与「调用方显式传的头优先」
    // 这两件事同时成立（后者靠的是有值的槽位依然展开在最后）。
    await http().post('/probe/zhdj-post', { a: 1 }, { httpInstance: 'zhdj-cms' } as never)

    const hit = received.at(-1)!
    expect(hit.headers['content-type']).toBe('application/x-www-form-urlencoded; charset=UTF-8')
  })
})
