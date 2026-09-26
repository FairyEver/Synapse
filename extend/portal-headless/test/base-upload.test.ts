import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import {
  BASE_UPLOAD_SOURCE,
  OSS_DELETE_MULTI_LIMIT,
  OSS_FOLDERS,
  OssCredentialError,
  OssRequestError,
  OssUploadParamError,
  assertFolder,
  assertOssConfig,
  assertSafeObjectKey,
  baseUploadCapabilities,
  buildAuthorizationV1,
  buildCanonicalResource,
  buildCanonicalStringV1,
  buildCanonicalizedResource,
  buildDeleteMultiXml,
  buildObjectKey,
  buildPublicUrl,
  computeSignatureV1,
  contentMd5Base64,
  contentTypeOf,
  createBaseUploadCapability,
  escapeObjectKey,
  formatOssDateV1,
  generateRandomObjectName,
  parseAclXml,
  parseDeleteMultiXml,
  parseOssErrorXml,
  prepareOssRequest,
  redactOssConfig,
  safeExtension,
  splitObjectKeyList,
  type FetchLike,
} from '../src/capabilities/base-upload.js'

/**
 * `base-upload` —— 基础能力（不属于任何页面）。
 *
 * 这份文件有**两组性质完全不同**的用例，读的时候别混：
 *
 * ## ①～⑦ 离线组（默认全跑，绝不碰网络）
 *
 * canonical string / 签名的字面量，是**照 OSS V1 规范与 ali-oss 6.20.0 的实现逐行构造的
 * 期望值**。它们证明的是「我们的实现与 ali-oss 的构造逻辑一致」：
 * canonical string 第 4 行放 x-oss-date、`x-oss-date` 在 canonicalized OSS headers 里
 * 再出现一次、子资源 `?acl` 不带 `=`、签名是 `base64(HMAC-SHA1(secret, canonicalString))`。
 *
 * 所有 HTTP 都走**注入的假 fetch**，一个字节都不出本机。
 * 凭据用全是编的假串（`test-ak-id` / `test-ak-secret`），**不是任何环境里的真值**。
 *
 * ## ⑧ LIVE 组（默认 skip，只有 `OSS_*` 环境变量齐了才跑）
 *
 * **会真写测试环境的桶**（`SDK-TEST-` 前缀的探针对象，用完删掉）。
 * 跑法：
 *
 * ```bash
 * smoke/with-oss-credentials.sh pnpm exec vitest run test/base-upload.test.ts
 * ```
 *
 * 它回答的是离线组**回答不了**的那个问题：**OSS 服务端认不认我们算的签名**。
 * 2026-09-20 在测试环境实跑通过，结论逐条记在 `docs/base/上传.md` §6。
 * 离线组在"我们算错了"时会红；LIVE 组才在"OSS 不认"时会红 —— 两者缺一不可。
 *
 * 文件末尾还有一个**必须显式点名**的清理入口（`OSS_CLEANUP_OBJECT_KEY`），
 * 用来删掉遗留的测试产物 —— 一次只删一个，不提供按前缀扫射的入口。
 */

/** 显然是假的凭据。任何真实 AK/SK **都不许**出现在这个文件里。 */
const FAKE_CONFIG = {
  accessKeyId: 'test-ak-id',
  accessKeySecret: 'test-ak-secret',
  bucket: 'test-bucket',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
} as const

/** 固定的时刻：2026-09-20 12:34:56 UTC。签名与对象名都从它算，保证可复现。 */
const FIXED_DATE = new Date(Date.UTC(2026, 8, 20, 12, 34, 56))
const FIXED_RFC1123 = 'Sun, 20 Sep 2026 12:34:56 GMT'

const FIXED_KEY = 'HR/public/2026/09/abcdefghijklmnop.png'

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string }

/** 假 OSS：记下每一次请求，按 status 返回罐装响应。一个字节都不出本机。 */
function fakeOss (options: {
  putStatus?: number
  aclPutStatus?: number
  aclGetBody?: string
  aclGetStatus?: number
  deleteStatus?: number
  deleteMultiBody?: string
  errorBody?: string
  requestId?: string
} = {}) {
  const calls: Recorded[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[key] = String(value)
    }
    const body = init.body === undefined || init.body === null
      ? undefined
      : Buffer.from(init.body as Uint8Array).toString('utf8')
    calls.push({ url, method: String(init.method ?? 'GET'), headers, ...(body === undefined ? {} : { body }) })

    const isAcl = url.includes('?acl')
    const isDeleteMulti = url.includes('?delete')
    const status = isDeleteMulti || init.method === 'DELETE'
      ? (options.deleteStatus ?? 200)
      : isAcl
        ? (init.method === 'GET'
            ? (options.aclGetStatus ?? 200)
            : (options.aclPutStatus ?? 200))
        : (options.putStatus ?? 200)

    if (status >= 400) {
      return new Response(
        options.errorBody ??
          '<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>',
        { status, headers: { 'x-oss-request-id': options.requestId ?? 'test-req-id' } },
      )
    }
    if (init.method === 'GET' && isAcl) {
      return new Response(
        options.aclGetBody ??
          '<AccessControlPolicy><AccessControlList><Grant>public-read</Grant></AccessControlList></AccessControlPolicy>',
        { status },
      )
    }
    // 批量删除的响应体：默认**逐个回报删掉了哪些键**（Quiet=false 时 OSS 的行为）
    if (isDeleteMulti) {
      const requested = [...(body ?? '').matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => m[1] ?? '')
      const fallback =
        '<?xml version="1.0" encoding="UTF-8"?><DeleteResult>' +
        requested.map((key) => `<Deleted><Key>${key}</Key></Deleted>`).join('') +
        '</DeleteResult>'
      return new Response(options.deleteMultiBody ?? fallback, { status })
    }
    return new Response('', { status })
  }
  return { fetchImpl, calls }
}

function capability (fetchImpl: FetchLike, overrides: Record<string, unknown> = {}) {
  return createBaseUploadCapability({
    ...FAKE_CONFIG,
    runtime: {
      fetch: fetchImpl,
      now: () => FIXED_DATE,
      randomName: () => 'abcdefghijklmnop',
    },
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// ① 签名（V1）—— 本单的核心断言
// ---------------------------------------------------------------------------

describe('V1 签名（照 OSS 规范与 ali-oss 实现构造，未与真实 OSS 对过）', () => {
  it('日期串是 RFC1123 GMT（ali-oss 在 authorizationV4 为假时用的格式）', () => {
    expect(formatOssDateV1(FIXED_DATE)).toBe(FIXED_RFC1123)
    // 用另一天再钉一次，防止"碰巧对"：2026-01-05 是周一
    expect(formatOssDateV1(new Date(Date.UTC(2026, 0, 5, 0, 0, 0)))).toBe('Mon, 05 Jan 2026 00:00:00 GMT')
  })

  it('canonical string 逐行就是 OSS V1 的形状（字面量钉死）', () => {
    const md5 = contentMd5Base64(Buffer.from('hello-oss', 'utf8'))
    // 这个 md5 也是字面量：换掉内容的编码方式（比如写成 hex）这条会红
    expect(md5).toBe('/59sA30D4RHZw+GH1fW1IA==')

    const canonical = buildCanonicalStringV1({
      method: 'PUT',
      contentMd5: md5,
      contentType: 'image/png',
      date: FIXED_RFC1123,
      ossHeaders: { 'x-oss-date': FIXED_RFC1123 },
      resource: buildCanonicalResource('test-bucket', FIXED_KEY),
    })

    expect(canonical).toBe(
      [
        'PUT',
        '/59sA30D4RHZw+GH1fW1IA==',
        'image/png',
        FIXED_RFC1123,
        // ⚠️ x-oss-date 出现两次：一次占 Date 的位置，一次在 canonicalized OSS headers 里。
        // ali-oss 不把它从后者排除（signUtils.js:59-72 只按 x-oss- 前缀收集），OSS 服务端同样如此。
        `x-oss-date:${FIXED_RFC1123}`,
        '/test-bucket/HR/public/2026/09/abcdefghijklmnop.png',
      ].join('\n'),
    )
  })

  it('签名是 base64(HMAC-SHA1(secret, canonicalString))，Authorization 是 `OSS ak:sig`', () => {
    const canonical = buildCanonicalStringV1({
      method: 'PUT',
      contentMd5: '/59sA30D4RHZw+GH1fW1IA==',
      contentType: 'image/png',
      date: FIXED_RFC1123,
      ossHeaders: { 'x-oss-date': FIXED_RFC1123 },
      resource: buildCanonicalResource('test-bucket', FIXED_KEY),
    })

    expect(computeSignatureV1('test-ak-secret', canonical)).toBe('GN5qSxtBO9iUnzDxXyXKp0uitDc=')
    expect(
      buildAuthorizationV1({
        accessKeyId: 'test-ak-id',
        accessKeySecret: 'test-ak-secret',
        canonicalString: canonical,
      }),
    ).toBe('OSS test-ak-id:GN5qSxtBO9iUnzDxXyXKp0uitDc=')
  })

  it('换掉 secret 签名就变（防止"恒真"的假断言）', () => {
    const canonical = buildCanonicalStringV1({
      method: 'PUT',
      date: FIXED_RFC1123,
      resource: '/test-bucket/a.png',
    })
    expect(computeSignatureV1('test-ak-secret', canonical)).not.toBe(
      computeSignatureV1('another-secret', canonical),
    )
  })

  it('方法的大小写不影响 canonical string（统一转大写）', () => {
    const upper = buildCanonicalStringV1({ method: 'PUT', date: FIXED_RFC1123, resource: '/b/k' })
    const lower = buildCanonicalStringV1({ method: 'put', date: FIXED_RFC1123, resource: '/b/k' })
    expect(lower).toBe(upper)
    expect(upper.startsWith('PUT\n')).toBe(true)
  })

  it('canonicalized resource：子资源排序、值空的只留 key（?acl 不带 =）', () => {
    expect(buildCanonicalizedResource('/b/k')).toBe('/b/k')
    expect(buildCanonicalizedResource('/b/k', { acl: '' })).toBe('/b/k?acl')
    // 多子资源按 key 字典序，不是按传入顺序
    expect(buildCanonicalizedResource('/b/k', { uploadId: 'x', partNumber: '2' })).toBe(
      '/b/k?partNumber=2&uploadId=x',
    )
    // 桶名恒在 canonical resource 里，与 cname 与否无关（ali-oss 的 _getResource 恒带桶名）
    expect(buildCanonicalResource('test-bucket', 'a/b.png')).toBe('/test-bucket/a/b.png')
  })

  it('prepareOssRequest 把 Authorization 换成签名，且签名随 canonical string 走', () => {
    const resolved = assertOssConfig({ ...FAKE_CONFIG })
    const prepared = prepareOssRequest({
      config: resolved,
      method: 'PUT',
      objectKey: FIXED_KEY,
      contentType: 'image/png',
      body: Buffer.from('hello-oss', 'utf8'),
      now: FIXED_DATE,
    })

    expect(prepared.headers.Authorization).toBe('OSS test-ak-id:GN5qSxtBO9iUnzDxXyXKp0uitDc=')
    expect(prepared.headers['x-oss-date']).toBe(FIXED_RFC1123)
    expect(prepared.headers['Content-MD5']).toBe('/59sA30D4RHZw+GH1fW1IA==')
    expect(prepared.headers['Content-Length']).toBe('9')
    expect(prepared.headers['Content-Type']).toBe('image/png')
    // canonical string 里必须有这个对象，否则签的是别的东西
    expect(prepared.canonicalString).toContain('/test-bucket/HR/public/2026/09/abcdefghijklmnop.png')
  })

  it('ACL 请求带 ?acl 子资源；putACL 的 x-oss-object-acl 进 canonical string', () => {
    const resolved = assertOssConfig({ ...FAKE_CONFIG })
    const get = prepareOssRequest({
      config: resolved,
      method: 'GET',
      objectKey: FIXED_KEY,
      subresources: { acl: '' },
      now: FIXED_DATE,
    })
    // URL 带等号、canonical resource 不带 —— 见下面 getAcl/putAcl 那条的说明
    expect(get.url).toBe(`https://oss-cn-hangzhou.aliyuncs.com/${FIXED_KEY}?acl=`)
    expect(get.canonicalString.split('\n').at(-1)).toBe(`/test-bucket/${FIXED_KEY}?acl`)

    const put = prepareOssRequest({
      config: resolved,
      method: 'PUT',
      objectKey: FIXED_KEY,
      subresources: { acl: '' },
      ossHeaders: { 'x-oss-object-acl': 'public-read' },
      contentType: 'application/xml',
      now: FIXED_DATE,
    })
    const lines = put.canonicalString.split('\n')
    expect(lines).toContain('x-oss-object-acl:public-read')
    // 排序：x-oss-date 在 x-oss-object-acl 之前
    expect(lines.indexOf(`x-oss-date:${FIXED_RFC1123}`)).toBeLessThan(
      lines.indexOf('x-oss-object-acl:public-read'),
    )
  })

  it('签名带的是 header 里的真实值：改了 content-type，签名跟着变', () => {
    const resolved = assertOssConfig({ ...FAKE_CONFIG })
    const a = prepareOssRequest({ config: resolved, method: 'PUT', objectKey: FIXED_KEY, contentType: 'image/png', now: FIXED_DATE })
    const b = prepareOssRequest({ config: resolved, method: 'PUT', objectKey: FIXED_KEY, contentType: 'text/plain', now: FIXED_DATE })
    expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
  })
})

// ---------------------------------------------------------------------------
// ② 凭据：失败关闭 + 不落盘
// ---------------------------------------------------------------------------

describe('凭据（缺就报错，且不进任何输出）', () => {
  it('全缺时抛 OssCredentialError，四个字段一次说清', () => {
    expect(() => assertOssConfig({})).toThrow(OssCredentialError)
    try {
      assertOssConfig({})
      expect.unreachable('缺凭据时必须抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(OssCredentialError)
      expect((error as OssCredentialError).fields).toEqual([
        'accessKeyId',
        'accessKeySecret',
        'bucket',
        'endpoint',
      ])
    }
  })

  it('只缺 secret 时只报 secret，且不会因为"有别的字段"就放行', () => {
    try {
      assertOssConfig({ ...FAKE_CONFIG, accessKeySecret: '' })
      expect.unreachable('空的 accessKeySecret 必须抛错')
    } catch (error) {
      expect((error as OssCredentialError).fields).toEqual(['accessKeySecret'])
    }
  })

  it('空串与纯空白都算缺（不是 falsy 判断，是 trim 后判断）', () => {
    expect(() => assertOssConfig({ ...FAKE_CONFIG, accessKeyId: '   ' })).toThrow(OssCredentialError)
  })

  // -------------------------------------------------------------------------
  // ⚠️ 这一组锁的是**校验时机**，它 2026-09-20 被明确改过：
  //    旧行为 = 创建能力时就校验；新行为 = 第一次真要用凭据时才校验。
  //
  //    为什么改：上传是**可选**能力，绝大多数调用方根本不配 OSS。创建时就校验会让
  //    `config.oss ?? {}` 把**每一个没配 OSS 的用户**的 `createPortalHeadless()` 弄挂
  //    —— 一个可选能力把主干拖死。所以时机后移。
  //
  //    为什么**不是删掉这条断言**：失败关闭的性质没变，只是时机变了。
  //    所以下面正面锁住新时机的两半：① 创建时**不抛**；② 真要用的时候**抛，且不发请求**。
  //    旧断言（「创建时就校验」）锁的是被废弃的行为，删掉它是**改断言**不是**放松断言**。
  // -------------------------------------------------------------------------

  it('未配置凭据时，创建能力**不抛**（可选能力不能把 SDK 创建弄挂）', () => {
    // 空配置、以及"配了一半"都必须在创建这一步活下来
    expect(() => createBaseUploadCapability({})).not.toThrow()
    expect(() => createBaseUploadCapability({ bucket: 'b', endpoint: 'e' })).not.toThrow()
    // describeConfig 是排查用的，没配凭据时也必须能用
    expect(() => createBaseUploadCapability({}).describeConfig()).not.toThrow()
  })

  it('未配置凭据时 upload 抛 OssCredentialError，且**一个请求都没发**', async () => {
    const oss = fakeOss()
    // 注意：这里**没有**注入 runtime.now/randomName，凭据校验必须排在这些之前
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })

    await expect(
      cap.upload({ content: Buffer.from('x'), folder: 'Portal/public', contentType: 'text/plain' }),
    ).rejects.toThrow(OssCredentialError)
    expect(oss.calls.length).toBe(0)
  })

  it('凭据校验排在**参数校验与读文件之前** —— 两边都错时报的是凭据', async () => {
    const oss = fakeOss()
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })

    // 文件不存在 **且** 凭据没配：必须报凭据 —— 它才是真正的拦路虎。
    // 报「读不到本地文件」会把调用方支去查路径，而真正的问题是没配凭据。
    const error = await cap
      .upload({ path: '/definitely/not/here.bin', folder: 'Portal/public' })
      .then(() => '<没有抛错>' as const, (e: unknown) => e)

    expect(error).toBeInstanceOf(OssCredentialError)
    expect(String(error)).not.toContain('读不到本地文件')
    expect(oss.calls.length).toBe(0)
  })

  it('未配置凭据时 getAcl 抛 OssCredentialError，且**一个请求都没发**', async () => {
    const oss = fakeOss()
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })

    await expect(cap.getAcl('HR/public/2026/09/a.png')).rejects.toThrow(OssCredentialError)
    expect(oss.calls.length).toBe(0)
  })

  it('未配置凭据时 putAcl 抛 OssCredentialError，且**一个请求都没发**', async () => {
    const oss = fakeOss()
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })

    await expect(cap.putAcl('HR/public/2026/09/a.png', 'public-read')).rejects.toThrow(
      OssCredentialError,
    )
    expect(oss.calls.length).toBe(0)
  })

  it('三个方法的凭据报错文案一样，都能直接看出缺哪几个字段', async () => {
    const oss = fakeOss()
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })

    const messages = await Promise.all(
      [
        cap.upload({ content: Buffer.from('x'), folder: 'Portal/public' }),
        cap.getAcl('HR/public/a.png'),
        cap.putAcl('HR/public/a.png', 'public-read'),
      ].map((p) => p.then(() => '<没有抛错>', (error: unknown) => String(error))),
    )

    expect(messages.every((text) => text.includes('accessKeyId, accessKeySecret, bucket, endpoint'))).toBe(true)
    expect(messages.every((text) => text !== '<没有抛错>')).toBe(true)
    expect(oss.calls.length).toBe(0)
  })

  it('配好了凭据就照常走完三步 —— 懒校验没有把正常路径也挡掉', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    const result = await cap.upload({
      content: Buffer.from('x'),
      folder: 'Portal/public',
      contentType: 'text/plain',
    })
    expect(result.objectKey).toBe('Portal/public/2026/09/abcdefghijklmnop')
    expect(oss.calls.length).toBe(3)
  })

  it('报错文本里没有 secret 的原文（这是"不落盘"最关键的一条）', () => {
    const secret = 'SUPER-SECRET-DO-NOT-LEAK'
    try {
      assertOssConfig({ accessKeyId: 'ak', accessKeySecret: secret, bucket: '', endpoint: '' })
      expect.unreachable('缺 bucket/endpoint 时必须抛错')
    } catch (error) {
      const text = String(error)
      expect(text).not.toContain(secret)
      expect(text).toContain('<redacted>')
    }
  })

  it('redactOssConfig：secret 全抹、ak 只留前 4 位', () => {
    const redacted = redactOssConfig({ ...FAKE_CONFIG })
    expect(redacted.accessKeySecret).toBe('<redacted>')
    expect(redacted.accessKeyId).toBe('test<redacted>')
    expect(JSON.stringify(redacted)).not.toContain('test-ak-secret')
    // 非秘密字段照原样留着，否则排查时什么都看不到
    expect(redacted.bucket).toBe('test-bucket')
    expect(redacted.endpoint).toBe('oss-cn-hangzhou.aliyuncs.com')
  })

  it('能力暴露的 describeConfig 也是抹过的', () => {
    const cap = capability(fakeOss().fetchImpl)
    const described = cap.describeConfig()
    expect(described.accessKeySecret).toBe('<redacted>')
    expect(JSON.stringify(described)).not.toContain('test-ak-secret')
  })

  it('endpoint 带协议前缀时当场报错（它必须是主机名）', () => {
    expect(() => assertOssConfig({ ...FAKE_CONFIG, endpoint: 'https://oss.example.com' })).toThrow(
      OssUploadParamError,
    )
  })
})

// ---------------------------------------------------------------------------
// ③ folder 白名单与 objectKey
// ---------------------------------------------------------------------------

describe('folder 与 objectKey', () => {
  it('白名单是 31 个，全部形如 Aaa/bbb（取自 ossFilePathOptions）', () => {
    expect(OSS_FOLDERS.length).toBe(31)
    for (const folder of OSS_FOLDERS) {
      expect(folder).toMatch(/^[A-Za-z]+\/[A-Za-z]+$/)
    }
    // 抽查几条，防止顺序被无意重排
    expect(OSS_FOLDERS[0]).toBe('Public/public')
    expect(OSS_FOLDERS).toContain('HR/approval')
    expect(OSS_FOLDERS).toContain('Finance/audit')
    expect(OSS_FOLDERS).toContain('Research/public')
  })

  it('不在白名单里的 folder 直接拒绝，报错里列出允许的取值', () => {
    try {
      assertFolder('MyOwnFolder/x')
      expect.unreachable('自造的 folder 必须被拒')
    } catch (error) {
      expect(error).toBeInstanceOf(OssUploadParamError)
      expect(String(error)).toContain('HR/public')
    }
  })

  it('folder 大小写敏感：hr/public 不是 HR/public', () => {
    expect(() => assertFolder('hr/public')).toThrow(OssUploadParamError)
  })

  it('objectKey = {folder}/{YYYY}/{MM}/{name}{.ext}（逐字段复刻 oss.js:171）', () => {
    const built = buildObjectKey({
      folder: 'HR/public',
      sourceFileName: 'photo.png',
      now: FIXED_DATE,
      randomName: () => 'abcdefghijklmnop',
    })
    expect(built.objectKey).toBe('HR/public/2026/09/abcdefghijklmnop.png')
    expect(built.objectName).toBe('abcdefghijklmnop.png')
  })

  it('固定名优先，扩展名仍从源文件名取', () => {
    const built = buildObjectKey({
      folder: 'Finance/expense',
      fixedName: 'invoice',
      sourceFileName: '2026-09.pdf',
      now: FIXED_DATE,
      randomName: () => 'zzzzzzzzzzzzzzzz',
    })
    expect(built.objectKey).toBe('Finance/expense/2026/09/invoice.pdf')
  })

  it('月份补零（1 月是 01，不是 1）', () => {
    const built = buildObjectKey({
      folder: 'Portal/public',
      sourceFileName: 'a.png',
      now: new Date(Date.UTC(2026, 0, 5)),
      randomName: () => 'abcdefghijklmnop',
    })
    expect(built.objectKey).toBe('Portal/public/2026/01/abcdefghijklmnop.png')
  })

  it('扩展名白名单外的一律不带扩展名（不复刻 split(".").pop() 原样拼接）', () => {
    expect(safeExtension('evil.svg?x=1')).toBe('')
    expect(safeExtension('noext')).toBe('')
    expect(safeExtension('a.PNG')).toBe('.png')
    const built = buildObjectKey({
      folder: 'Portal/public',
      sourceFileName: 'payload.tar.gz',
      now: FIXED_DATE,
      randomName: () => 'abcdefghijklmnop',
    })
    expect(built.objectKey.endsWith('.gz')).toBe(true)
    const weird = buildObjectKey({
      folder: 'Portal/public',
      sourceFileName: 'x.evil',
      now: FIXED_DATE,
      randomName: () => 'abcdefghijklmnop',
    })
    expect(weird.objectKey).toBe('Portal/public/2026/09/abcdefghijklmnop')
  })

  it('fixedName 里带路径分隔符或空格时拒绝（它会被拼进签名资源）', () => {
    expect(() =>
      buildObjectKey({ folder: 'Portal/public', fixedName: '../../etc/passwd', now: FIXED_DATE }),
    ).toThrow(OssUploadParamError)
    expect(() =>
      buildObjectKey({ folder: 'Portal/public', fixedName: 'a b', now: FIXED_DATE }),
    ).toThrow(OssUploadParamError)
  })

  it('随机名是 16 位小写字母', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateRandomObjectName()).toMatch(/^[a-z]{16}$/)
    }
  })

  it('随机名用注入的字节流（可复现）', () => {
    // 每个字节 % 26 → 0='a'，25='z'
    const bytes = Buffer.alloc(16)
    for (let i = 0; i < 16; i += 1) bytes[i] = i
    expect(generateRandomObjectName(() => bytes)).toBe('abcdefghijklmnop')
  })

  it('注入的随机名形状不对时拒绝，而不是原样拼进路径', () => {
    expect(() =>
      buildObjectKey({ folder: 'Portal/public', now: FIXED_DATE, randomName: () => 'A/B' }),
    ).toThrow(OssUploadParamError)
  })
})

// ---------------------------------------------------------------------------
// ④ URL：https（不复刻 ali-oss 的 http:// 缺陷）
// ---------------------------------------------------------------------------

describe('可访问 url', () => {
  it('默认给 https（Portal 的 ossPut 实际返回 http://，靠页面 fixHttpsUrl 兜底）', () => {
    expect(
      buildPublicUrl({
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        bucket: 'test-bucket',
        objectKey: FIXED_KEY,
        cname: true,
        secure: true,
      }),
    ).toBe(`https://oss-cn-hangzhou.aliyuncs.com/${FIXED_KEY}`)
  })

  it('cname=false 时桶名进 host（两种模式的 canonical resource 都是恒带桶名的）', () => {
    expect(
      buildPublicUrl({
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        bucket: 'test-bucket',
        objectKey: 'a.png',
        cname: false,
        secure: true,
      }),
    ).toBe('https://test-bucket.oss-cn-hangzhou.aliyuncs.com/a.png')
  })

  it('secure=false 才给 http（调用方显式要求时才降级）', () => {
    expect(
      buildPublicUrl({
        endpoint: 'e.com',
        bucket: 'b',
        objectKey: 'a.png',
        cname: true,
        secure: false,
      }),
    ).toBe('http://e.com/a.png')
  })

  it('cname 默认 true：与 oss.js:37 的 `cname: !!endpoint` 一致', () => {
    const resolved = assertOssConfig({ ...FAKE_CONFIG })
    expect(resolved.cname).toBe(true)
    expect(resolved.secure).toBe(true)
  })

  it('对象路径里的 / 保留、其它字符编码（复刻 ali-oss 的 _escape）', () => {
    expect(escapeObjectKey('HR/public/a.png')).toBe('HR/public/a.png')
    expect(escapeObjectKey('HR/public/a b.png')).toBe('HR/public/a%20b.png')
  })
})

// ---------------------------------------------------------------------------
// ⑤ 端到端：put → putACL → getACL（假 fetch，不出本机）
// ---------------------------------------------------------------------------

describe('upload：三步链路（假 OSS，无真实网络）', () => {
  it('依次发 PutObject、PutObjectACL、GetObjectACL，顺序不能变', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)

    const result = await cap.upload({
      content: Buffer.from('hello-oss', 'utf8'),
      folder: 'HR/public',
      fileName: 'photo.png',
      fixedName: 'abcdefghijklmnop',
      contentType: 'image/png',
    })

    expect(oss.calls.map((c) => `${c.method} ${c.url.includes('?acl') ? 'acl' : 'object'}`)).toEqual([
      'PUT object',
      'PUT acl',
      'GET acl',
    ])
    expect(result.url).toBe(`https://oss-cn-hangzhou.aliyuncs.com/${FIXED_KEY}`)
    expect(result.objectKey).toBe(FIXED_KEY)
    expect(result.size).toBe(9)
    expect(result.contentType).toBe('image/png')
    // acl 是**读回来的**，不是我们填的那个字面量
    expect(result.acl).toBe('public-read')
  })

  it('第二步带 x-oss-object-acl: public-read —— 省了它 url 读不出来（oss.js:176-177）', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    await cap.upload({ content: Buffer.from('x'), folder: 'Portal/public', contentType: 'text/plain' })

    const aclPut = oss.calls.find((c) => c.method === 'PUT' && c.url.includes('?acl'))
    expect(aclPut?.headers['x-oss-object-acl']).toBe('public-read')
  })

  it('签名头真的发给了 OSS，而 body 是原始字节', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    await cap.upload({ content: Buffer.from('hello-oss', 'utf8'), folder: 'Portal/public', contentType: 'text/plain' })

    const put = oss.calls[0]
    expect(put?.headers.Authorization).toMatch(/^OSS test-ak-id:/)
    expect(put?.headers['Content-MD5']).toBe('/59sA30D4RHZw+GH1fW1IA==')
    expect(put?.body).toBe('hello-oss')
  })

  it('GetObjectACL 失败不影响上传结果 —— acl 留空，其余照常返回', async () => {
    const oss = fakeOss({ aclGetStatus: 403 })
    const cap = capability(oss.fetchImpl)
    const result = await cap.upload({ content: Buffer.from('x'), folder: 'Portal/public', contentType: 'text/plain' })
    expect(result.acl).toBeUndefined()
    expect(result.url).toContain('https://')
  })

  it('PutObject 被拒时抛 OssRequestError，且带上 OSS 的 Code 与 requestId', async () => {
    const oss = fakeOss({ putStatus: 403, requestId: 'req-abc' })
    const cap = capability(oss.fetchImpl)
    try {
      await cap.upload({ content: Buffer.from('x'), folder: 'Portal/public', contentType: 'text/plain' })
      expect.unreachable('403 必须抛错，不能静默成功')
    } catch (error) {
      expect(error).toBeInstanceOf(OssRequestError)
      expect((error as OssRequestError).status).toBe(403)
      expect((error as OssRequestError).code).toBe('SignatureDoesNotMatch')
      expect((error as OssRequestError).requestId).toBe('req-abc')
      // 报错里给 canonical string 便于对照，但**不能**给密钥
      expect(String(error)).toContain('canonical string')
      expect(String(error)).not.toContain('test-ak-secret')
    }
  })

  it('第 2 步（putACL）失败时**不返回成功的 url** —— 否则调用方会存下一个读不出来的地址', async () => {
    const oss = fakeOss({ aclPutStatus: 403 })
    const cap = capability(oss.fetchImpl)
    await expect(
      cap.upload({ content: Buffer.from('x'), folder: 'Portal/public', contentType: 'text/plain' }),
    ).rejects.toThrow(OssRequestError)
    // 只发了 put 与 putACL，没有多余的第三步
    expect(oss.calls.length).toBe(2)
  })

  it('content 与 path 都给时拒绝（不猜优先级）', async () => {
    const cap = capability(fakeOss().fetchImpl)
    await expect(
      cap.upload({ content: Buffer.from('x'), path: '/tmp/a', folder: 'Portal/public' } as never),
    ).rejects.toThrow(OssUploadParamError)
  })

  it('两个都不给时拒绝', async () => {
    const cap = capability(fakeOss().fetchImpl)
    await expect(cap.upload({ folder: 'Portal/public' } as never)).rejects.toThrow(OssUploadParamError)
  })

  it('读不到本地文件时给能看懂的错，而不是 ENOENT 裸奔', async () => {
    const cap = capability(fakeOss().fetchImpl)
    await expect(
      cap.upload({ path: '/definitely/not/here.bin', folder: 'Portal/public' }),
    ).rejects.toThrow(/读不到本地文件/)
  })

  it('从 path 上传：读真实字节，扩展名从路径推', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    // 用本测试文件自己当输入 —— 真实存在的本地文件，读完不出本机
    const result = await cap.upload({ path: fileURLToPath(import.meta.url), folder: 'Portal/public' })
    expect(result.contentType).toBe('application/octet-stream') // .ts 不在白名单里
    expect(result.objectKey).toBe('Portal/public/2026/09/abcdefghijklmnop')
    expect(result.size).toBeGreaterThan(0)
  })

  it('不给 fileName 时用随机名（注入的随机源）', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    const result = await cap.upload({ content: Buffer.from('x'), folder: 'Research/public', contentType: 'text/plain' })
    expect(result.objectKey).toBe('Research/public/2026/09/abcdefghijklmnop')
  })

  it('prepare 一个字节都不发，但算出来的 identity 与 upload 完全一致', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)

    const prepared = await cap.prepare({
      content: Buffer.from('hello-oss', 'utf8'),
      folder: 'HR/public',
      fileName: 'photo.png',
      fixedName: 'abcdefghijklmnop',
      contentType: 'image/png',
    })
    expect(oss.calls.length).toBe(0) // 关键：没发网络
    expect(prepared.objectKey).toBe(FIXED_KEY)
    expect(prepared.publicUrl).toBe(`https://oss-cn-hangzhou.aliyuncs.com/${FIXED_KEY}`)
    // 与上面那条字面量断言同一个签名：prepare 与 upload 走的是同一条签名路径
    expect(prepared.headers.Authorization).toBe('OSS test-ak-id:GN5qSxtBO9iUnzDxXyXKp0uitDc=')

    const uploaded = await cap.upload({
      content: Buffer.from('hello-oss', 'utf8'),
      folder: 'HR/public',
      fileName: 'photo.png',
      fixedName: 'abcdefghijklmnop',
      contentType: 'image/png',
    })
    expect(uploaded.objectKey).toBe(prepared.objectKey)
    expect(uploaded.url).toBe(prepared.publicUrl)
  })

  it('getAcl / putAcl 单独可用（补第 2 步失败时用）', async () => {
    const oss = fakeOss({ aclGetBody: '<AccessControlPolicy><AccessControlList><Grant>private</Grant></AccessControlList></AccessControlPolicy>' })
    const cap = capability(oss.fetchImpl)

    await cap.putAcl(FIXED_KEY, 'public-read')
    // ⚠️ URL 上是 `?acl=`（带等号），canonical resource 上是 `?acl`（不带）——
    // 这**不是笔误**，是 ali-oss 的真实行为：`url.format({acl:''})` 会补上等号（实测过），
    // 而 buildCanonicalizedResource 对空值不拼 `=`。两处都照抄，见 prepareOssRequest 里的注释。
    expect(oss.calls[0]?.url).toBe(`https://oss-cn-hangzhou.aliyuncs.com/${FIXED_KEY}?acl=`)
    expect(oss.calls[0]?.headers['x-oss-object-acl']).toBe('public-read')

    expect(await cap.getAcl(FIXED_KEY)).toBe('private')
  })

  it('解构出来的方法仍然能用（不依赖 this）', async () => {
    const oss = fakeOss()
    const { upload } = capability(oss.fetchImpl)
    const result = await upload({
      content: Buffer.from('x'),
      folder: 'HR/public',
      fileName: 'photo.png',
      fixedName: 'abcdefghijklmnop',
      contentType: 'image/png',
    })
    expect(result.objectKey).toBe(FIXED_KEY)
  })
})

// ---------------------------------------------------------------------------
// ⑥ 输入护栏
// ---------------------------------------------------------------------------

describe('objectKey 护栏', () => {
  it('拒前导斜杠、.. 、空段、与 URL 特殊字符', () => {
    // ⚠️ 这里断言的是**具体哪条护栏**报的，不只是"抛了错"。
    // 只写 toThrow 的话前导斜杠那条会被"空段"那条顺带罩住（`/a` 的首段就是空串），
    // 于是删掉前导斜杠检查这条用例照样绿 —— 恒真的假测试。反证时抓到过一次。
    const why = (fn: () => unknown): string => {
      try {
        fn()
        return '<没有抛错>'
      } catch (error) {
        return String(error)
      }
    }

    expect(why(() => assertSafeObjectKey('/HR/public/a.png'))).toContain('前导 /')
    expect(why(() => assertSafeObjectKey('HR/../etc/passwd'))).toContain('空段')
    expect(why(() => assertSafeObjectKey('HR//a.png'))).toContain('空段')
    expect(why(() => assertSafeObjectKey('HR/a b.png'))).toContain('空格')
    expect(why(() => assertSafeObjectKey('HR/a.png?x=1'))).toContain('空格')
    expect(why(() => assertSafeObjectKey(''))).toContain('必填')
    expect(assertSafeObjectKey('HR/public/2026/09/a.png')).toBe('HR/public/2026/09/a.png')
  })

  it('扩展名猜 content-type，认不出给 octet-stream', () => {
    expect(contentTypeOf('a.png')).toBe('image/png')
    expect(contentTypeOf('a.PDF')).toBe('application/pdf')
    expect(contentTypeOf('a.unknownext')).toBe('application/octet-stream')
    expect(contentTypeOf('noext')).toBe('application/octet-stream')
  })

  it('OSS 错误 XML 解析：抠得到就给，抠不到不猜', () => {
    expect(parseOssErrorXml('<Error><Code>NoSuchKey</Code><Message>nope</Message></Error>')).toEqual({
      code: 'NoSuchKey',
      message: 'nope',
    })
    expect(parseOssErrorXml('<html>502</html>')).toEqual({ code: undefined, message: undefined })
    expect(parseAclXml('<AccessControlList><Grant>public-read</Grant></AccessControlList>')).toBe('public-read')
    expect(parseAclXml('<html/>')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ⑦ 能力定义
// ---------------------------------------------------------------------------

describe('能力定义', () => {
  it('五个能力 id 齐全，写标志正确', () => {
    expect(baseUploadCapabilities.map((c) => c.id)).toEqual([
      'base-upload-file',
      'base-upload-acl-get',
      'base-upload-delete',
      'base-upload-delete-multi',
      'base-upload-acl-set',
    ])
    const writes = Object.fromEntries(baseUploadCapabilities.map((c) => [c.id, c.write]))
    expect(writes).toEqual({
      'base-upload-file': true,
      'base-upload-acl-get': false,
      'base-upload-delete': true,
      'base-upload-delete-multi': true,
      'base-upload-acl-set': true,
    })

    // ⚠️ 上面那张表是**手写的期望值**，不是从 baseUploadCapabilities 推的 ——
    // 否则就是"断言与实现共享同一个常量"，加一个能力它会自动跟着变，等于没断言。
    // 下面这几条钉的是"每条定义本身是完整的"，防止新增定义时漏字段。
    expect(new Set(baseUploadCapabilities.map((c) => c.id)).size).toBe(baseUploadCapabilities.length)
    for (const definition of baseUploadCapabilities) {
      expect(definition.params.length, `${definition.id} 没有参数`).toBeGreaterThan(0)
      expect(definition.credentials.length, `${definition.id} 没有凭据声明`).toBeGreaterThan(0)
    }
  })

  it('删除类能力只有 objectKey/objectKeys，**不带** folder 一类上传参数', () => {
    const del = baseUploadCapabilities.find((c) => c.id === 'base-upload-delete')
    expect(del?.params.map((p) => p.name)).toEqual(['objectKey'])

    const multi = baseUploadCapabilities.find((c) => c.id === 'base-upload-delete-multi')
    expect(multi?.params.map((p) => p.name)).toEqual(['objectKeys'])
  })

  it('契约里**能看出哪些参数是凭据**：每个能力都声明了 credentials，且标了 kind', () => {
    for (const definition of baseUploadCapabilities) {
      expect(definition.credentials.length).toBeGreaterThan(0)
      const creds = definition.credentials.filter((f) => f.kind === 'credential').map((f) => f.name)
      expect(creds).toEqual(['accessKeyId', 'accessKeySecret'])
    }
  })

  it('凭据**不出现**在 params 里 —— 它不是每次调用要填的东西，也不该被 AI 传', () => {
    for (const definition of baseUploadCapabilities) {
      const names = definition.params.map((p) => p.name)
      expect(names).not.toContain('accessKeyId')
      expect(names).not.toContain('accessKeySecret')
      expect(names).not.toContain('bucket')
      expect(names).not.toContain('endpoint')
    }
  })

  it('folder 是 enum，候选就是那份 31 个的白名单', () => {
    const folder = baseUploadCapabilities[0]?.params.find((p) => p.name === 'folder')
    expect(folder?.kind).toBe('enum')
    expect(folder?.required).toBe(true)
    expect(folder?.options?.map((o) => o.value)).toEqual([...OSS_FOLDERS])
  })

  it('pagePath 是哨兵值，**不是菜单路径** —— 否则会把某个页面误判成已完成', () => {
    for (const definition of baseUploadCapabilities) {
      expect(definition.pagePath).toBe(BASE_UPLOAD_SOURCE)
      expect(definition.pagePath.startsWith('/')).toBe(false)
    }
  })

  it('这条链上没有任何硬编码的凭据（扫源码文本）', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(fileURLToPath(new URL('../src/capabilities/base-upload.ts', import.meta.url)), 'utf8')
    // 常见的 AK 形态：LTAI 开头的 20+ 位，或 32 位 hex
    expect(source).not.toMatch(/LTAI[A-Za-z0-9]{12,}/)
    expect(source).not.toMatch(/\b[0-9a-f]{32}\b/)
    expect(source).not.toMatch(/VITE_OSS_V2_ACCESS_KEY_(ID|SECRET)\s*[:=]\s*['"][^'"]+['"]/)
  })
})

// ---------------------------------------------------------------------------
// ⑨ 删除（DeleteObject / DeleteMultipleObjects）
//   这一族是 2026-09-21 补的：在此之前"传上去就删不掉"，测试产物只能堆在桶里。
// ---------------------------------------------------------------------------

describe('deleteObject：单个删除', () => {
  it('发的是 DELETE /{key}，带签名，返回 objectKey', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    const result = await cap.deleteObject(FIXED_KEY)

    expect(result.objectKey).toBe(FIXED_KEY)
    expect(oss.calls.length).toBe(1)
    expect(oss.calls[0]?.method).toBe('DELETE')
    expect(oss.calls[0]?.url).toBe(`https://oss-cn-hangzhou.aliyuncs.com/${FIXED_KEY}`)
    expect(oss.calls[0]?.headers.Authorization).toMatch(/^OSS test-ak-id:/)
    // DELETE 没有 body，也没有子资源
    expect(oss.calls[0]?.body).toBeUndefined()
    expect(oss.calls[0]?.url).not.toContain('?')
  })

  it('canonical resource 不带子资源（就是 /{bucket}/{key}）', () => {
    const resolved = assertOssConfig({ ...FAKE_CONFIG })
    const prepared = prepareOssRequest({
      config: resolved,
      method: 'DELETE',
      objectKey: FIXED_KEY,
      now: FIXED_DATE,
    })
    expect(prepared.canonicalString.split('\n').at(-1)).toBe(`/test-bucket/${FIXED_KEY}`)
    expect(prepared.canonicalString.startsWith('DELETE\n')).toBe(true)
    // 没有 body 时 Content-MD5 那行是空的
    expect(prepared.canonicalString.split('\n')[1]).toBe('')
  })

  it('OSS 拒绝时抛 OssRequestError（不是静默成功）', async () => {
    const oss = fakeOss({ deleteStatus: 403, requestId: 'del-req' })
    const cap = capability(oss.fetchImpl)
    await expect(cap.deleteObject(FIXED_KEY)).rejects.toThrow(OssRequestError)
  })

  it('未配置凭据时抛 OssCredentialError，且**一个请求都没发**', async () => {
    const oss = fakeOss()
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })
    await expect(cap.deleteObject(FIXED_KEY)).rejects.toThrow(OssCredentialError)
    expect(oss.calls.length).toBe(0)
  })

  it('objectKey 越界（前导斜杠 / .. / 空）当场拒，不发请求', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    for (const bad of ['/HR/a.png', 'HR/../x', 'HR//a.png', '', 'HR/a b.png']) {
      await expect(cap.deleteObject(bad)).rejects.toThrow(OssUploadParamError)
    }
    expect(oss.calls.length).toBe(0)
  })

  it('删不存在的 key 在 OSS 侧也是 204 —— 所以"删掉了没有"必须靠再读一次', async () => {
    // 假 fetch 一律 200；这个用例锁的是**我们不假装能分辨**
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    const result = await cap.deleteObject('HR/public/2026/09/never-existed.png')
    expect(result.objectKey).toBe('HR/public/2026/09/never-existed.png')
    // 返回值里**没有** "deleted: true" 这种字段 —— 有的话就是在撒谎
    expect(Object.keys(result)).toEqual(['objectKey'])
  })
})

describe('deleteMulti：批量删除（POST /?delete + XML body）', () => {
  const KEYS = [
    'HR/public/2026/09/a.png',
    'HR/public/2026/09/b.png',
    'Finance/expense/2026/09/c.pdf',
  ]

  it('发的是 POST /?delete=，Content-Type 是 XML，body 就是那份 XML', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    await cap.deleteMulti(KEYS)

    expect(oss.calls.length).toBe(1)
    const call = oss.calls[0]
    expect(call?.method).toBe('POST')
    // 桶级操作：路径是 /，子资源 ?delete=
    expect(call?.url).toBe('https://oss-cn-hangzhou.aliyuncs.com/?delete=')
    expect(call?.headers['Content-Type']).toBe('application/xml')
    expect(call?.headers['Content-MD5']).toBeTruthy()
    expect(call?.body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(call?.body).toContain('<Quiet>false</Quiet>')
    // 多元素：**三个都要在** body 里
    for (const key of KEYS) {
      expect(call?.body).toContain(`<Key>${key}</Key>`)
    }
    expect((call?.body?.match(/<Object>/g) ?? []).length).toBe(3)
  })

  it('canonical resource 是 /{bucket}/?delete（桶级 + 子资源，**恒带桶名**）', () => {
    const resolved = assertOssConfig({ ...FAKE_CONFIG })
    const prepared = prepareOssRequest({
      config: resolved,
      method: 'POST',
      objectKey: '',
      subresources: { delete: '' },
      contentType: 'application/xml',
      body: Buffer.from(buildDeleteMultiXml(KEYS), 'utf8'),
      now: FIXED_DATE,
    })
    expect(prepared.canonicalString.split('\n').at(-1)).toBe('/test-bucket/?delete')
  })

  it('多元素 + 特殊字符：`&` `<` `\'` 都要转义（不转义会拼出结构被改掉的 XML）', () => {
    const xml = buildDeleteMultiXml(['HR/a&b.png', 'HR/c<d>.png', "HR/e'f\".png"])
    expect(xml).toContain('<Key>HR/a&amp;b.png</Key>')
    expect(xml).toContain('<Key>HR/c&lt;d&gt;.png</Key>')
    expect(xml).toContain("<Key>HR/e&#39;f&quot;.png</Key>")
    // 转义之后不该再有**裸的** & < >。
    // ⚠️ 要先剥掉标签，再剥掉合法实体，最后才查 —— 直接查 `[&<>]` 会把 `&amp;`
    // 里那个 & 也算成裸的（第一版就是这么写错的，跑出来是红的，但红的是断言不是实现）。
    const inner = xml.replace(/<\/?[A-Za-z]+>/g, '').replace(/<\?xml[^>]*\?>/g, '')
    const withoutEntities = inner.replace(/&(amp|lt|gt|quot|#39);/g, '')
    expect(withoutEntities).not.toMatch(/[&<>]/)
    expect((xml.match(/<Object>/g) ?? []).length).toBe(3)
  })

  it('传字符串形态：换行与逗号都认，空段丢掉，重复去掉', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)
    await cap.deleteMulti('HR/a.png,\nHR/b.png\n\nHR/a.png,\n')
    const body = oss.calls[0]?.body ?? ''
    expect((body.match(/<Object>/g) ?? []).length).toBe(2) // a、b 各一次（a 去重了）
    expect(body).toContain('<Key>HR/a.png</Key>')
    expect(body).toContain('<Key>HR/b.png</Key>')
  })

  it('splitObjectKeyList 的多分支', () => {
    expect(splitObjectKeyList('a.png')).toEqual(['a.png'])
    expect(splitObjectKeyList('a.png,b.png')).toEqual(['a.png', 'b.png'])
    expect(splitObjectKeyList('a.png\nb.png')).toEqual(['a.png', 'b.png'])
    expect(splitObjectKeyList('  a.png  ,\n  b.png  ')).toEqual(['a.png', 'b.png'])
    expect(splitObjectKeyList('a.png,,,b.png,')).toEqual(['a.png', 'b.png'])
    expect(splitObjectKeyList('a.png,a.png')).toEqual(['a.png'])
    expect(splitObjectKeyList('')).toEqual([])
    expect(splitObjectKeyList(',\n,')).toEqual([])
  })

  it('清单里只要有一个越界 key，就**整批**拒掉，一个请求都不发', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)

    // 数组形态：好 key 与坏 key 混在一起
    await expect(cap.deleteMulti(['HR/ok.png', '/bad.png'])).rejects.toThrow(OssUploadParamError)
    await expect(cap.deleteMulti(['HR/ok.png', 'HR/../x.png'])).rejects.toThrow(OssUploadParamError)
    await expect(cap.deleteMulti(['HR/a b.png'])).rejects.toThrow(OssUploadParamError)
    // 字符串形态走进来也要过同一道校验
    await expect(cap.deleteMulti('HR/ok.png,HR/../x.png')).rejects.toThrow(OssUploadParamError)
    await expect(cap.deleteMulti('HR/ok.png\n/bad.png')).rejects.toThrow(OssUploadParamError)

    // 关键：不是"跳过坏的那个把好的删了"，而是**一个都没发**
    expect(oss.calls.length).toBe(0)
  })

  it('空清单 / 超过上限都在本地拒掉，不发请求', async () => {
    const oss = fakeOss()
    const cap = capability(oss.fetchImpl)

    await expect(cap.deleteMulti([])).rejects.toThrow(OssUploadParamError)
    await expect(cap.deleteMulti('')).rejects.toThrow(OssUploadParamError)
    await expect(cap.deleteMulti(',\n')).rejects.toThrow(OssUploadParamError)

    const tooMany = Array.from({ length: OSS_DELETE_MULTI_LIMIT + 1 }, (_, i) => `HR/${i}.png`)
    await expect(cap.deleteMulti(tooMany)).rejects.toThrow(/最多 1000 个/)
    // 边界：正好 1000 个要放行（不是 off-by-one 地拒了）
    await cap.deleteMulti(tooMany.slice(0, OSS_DELETE_MULTI_LIMIT))

    expect(oss.calls.length).toBe(1)
  })

  it('响应里逐个回报：Deleted 与 Error **可以同时存在**，不能只看 200', async () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<DeleteResult>',
      '<Deleted><Key>HR/a.png</Key></Deleted>',
      '<Deleted><Key>HR/b.png</Key></Deleted>',
      '<Error><Key>HR/c.png</Key><Code>AccessDenied</Code><Message>denied</Message></Error>',
      '</DeleteResult>',
    ].join('')
    const oss = fakeOss({ deleteMultiBody: xml })
    const cap = capability(oss.fetchImpl)
    const result = await cap.deleteMulti(['HR/a.png', 'HR/b.png', 'HR/c.png'])

    expect(result.deleted).toEqual(['HR/a.png', 'HR/b.png'])
    expect(result.errors).toEqual([{ key: 'HR/c.png', code: 'AccessDenied', message: 'denied' }])
  })

  it('parseDeleteMultiXml 的多分支', () => {
    expect(parseDeleteMultiXml('<DeleteResult></DeleteResult>')).toEqual({ deleted: [], errors: [] })
    expect(
      parseDeleteMultiXml('<DeleteResult><Deleted><Key>k1</Key></Deleted></DeleteResult>').deleted,
    ).toEqual(['k1'])
    const both = parseDeleteMultiXml(
      '<DeleteResult><Deleted><Key>k1</Key></Deleted><Error><Key>k2</Key><Code>X</Code></Error></DeleteResult>',
    )
    expect(both.deleted).toEqual(['k1'])
    expect(both.errors).toHaveLength(1)
    expect(both.errors[0]?.code).toBe('X')
  })

  it('未配置凭据时抛 OssCredentialError，且**一个请求都没发**', async () => {
    const oss = fakeOss()
    const cap = createBaseUploadCapability({ runtime: { fetch: oss.fetchImpl } })
    await expect(cap.deleteMulti(KEYS)).rejects.toThrow(OssCredentialError)
    expect(oss.calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ⑧ LIVE 真实 OSS —— 只有五个 OSS_* 环境变量都在时才跑
//
// 跑法（凭据不落盘，见 smoke/with-oss-credentials.sh）：
//   smoke/with-oss-credentials.sh pnpm exec vitest run test/base-upload.test.ts
//
// ⚠️ 这一组**会真写测试环境的桶**：每个用例建一个 `SDK-TEST-` 前缀的探针对象，
// 并在结束时删掉（`afterAll` 兜底）。**只删自己这次建的对象。**
//
// 这组用例存在的理由：本单前面所有关于签名的断言，证明的都只是
// 「我们的实现与 ali-oss 的构造逻辑一致」；**OSS 服务端认不认，只有真跑才知道**。
// 它们把 docs/base/上传.md §6.2 里那几条「推断」变成「实测」。
// ---------------------------------------------------------------------------

const liveConfig = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  endpoint: process.env.OSS_ENDPOINT,
  region: process.env.OSS_REGION,
}

const liveReady = Object.entries(liveConfig).every(
  ([key, value]) => (key === 'region' ? true : typeof value === 'string' && value !== ''),
)

/** 探针的固定名：`SDK-TEST-` 前缀，一眼看得出是谁留的 */
function probeName (): string {
  return `SDK-TEST-${randomUUID()}`
}

describe.skipIf(!liveReady)('LIVE 真实 OSS（会真写测试桶，自带清理）', () => {
  const upload = createBaseUploadCapability(liveConfig)
  /** 还没被删掉的对象，afterAll 兜底清 —— 任何一个用例中途炸了都不会留下垃圾 */
  const created = new Set<string>()
  /**
   * 本次**曾经建过**的所有对象，删了也不从这里面移除。
   *
   * ⚠️ 这个集合与 `created` 是两件事，别合并：`created` 是"待清理清单"（删掉就减），
   * 而"清理证据"那条用例要检查的是**曾经建过的每一个现在都打不开了**。
   * 拿 `created` 去查，那条用例会在一个空集合上循环、**一条断言都没执行**就通过 ——
   * 实测踩到过：它 0ms 跑完，是条恒真的假测试。
   */
  const everCreated = new Set<string>()

  function remember (objectKey: string): void {
    created.add(objectKey)
    everCreated.add(objectKey)
  }

  /** 不带任何签名头地读一个 url —— 这就是"外人能不能打开"的判据 */
  async function anonymousGet (url: string): Promise<{ status: number; body: string }> {
    const response = await fetch(url)
    return { status: response.status, body: await response.text() }
  }

  /** 签名 DELETE。用能力导出的原件自己拼，能力本身没有删除方法（见文档 §7） */
  /**
   * 走**能力自己的** `deleteObject`（不是测试里另拼一份签名逻辑）——
   * 这样 LIVE 组验的就是要交付的那条路。
   * 它删成功会抛错，所以这里把异常翻译回一个状态码给断言用。
   */
  async function deleteAndGetStatus (objectKey: string): Promise<number> {
    try {
      await upload.deleteObject(objectKey)
      created.delete(objectKey)
      return 204
    } catch (error) {
      if (error instanceof OssRequestError) return error.status
      throw error
    }
  }

  afterAll(async () => {
    for (const objectKey of created) {
      try {
        await deleteAndGetStatus(objectKey)
      } catch {
        // 兜底清理失败不掩盖真正的失败，但要把对象名喊出来
        process.stderr.write(`⚠️ 兜底清理失败，请人工删除：${objectKey}\n`)
      }
    }
  })

  it('① 端到端：上传 → ACL 读回 public-read → **匿名 GET 能打开且字节一致**', async () => {
    const body = `portal-headless live probe ${randomUUID()}\n`
    const name = probeName()
    // 先记下来：万一下面的断言失败，afterAll 仍然知道要清哪个
    const key = buildObjectKey({
      folder: 'Public/public',
      sourceFileName: 'probe.txt',
      fixedName: name,
      now: new Date(),
    }).objectKey
    remember(key)

    const result = await upload.upload({
      content: Buffer.from(body, 'utf8'),
      folder: 'Public/public',
      fixedName: name,
      fileName: 'probe.txt',
      contentType: 'text/plain',
    })

    expect(result.objectKey).toBe(key)
    // ⭐ V1 签名被 OSS 接受了 —— 走到这里说明 §6.2 的推断①成立
    expect(result.url.startsWith('https://')).toBe(true)
    // ⭐ GetObjectACL 走通了，且读回来的就是 public-read —— 推断② 成立
    expect(result.acl).toBe('public-read')

    // ⭐ 推断⑤：匿名读者真能打开这个 url
    const anon = await anonymousGet(result.url)
    expect(anon.status).toBe(200)
    expect(anon.body).toBe(body)

    // 清理 + 留下"清理过"的证据
    expect(await deleteAndGetStatus(result.objectKey)).toBeLessThan(300)
    const afterDelete = await anonymousGet(result.url)
    expect(afterDelete.status).not.toBe(200)
  })

  it('③ putACL 是不是必需：不设 ACL 的对象，匿名读**打不开**', async () => {
    const body = `portal-headless acl probe ${randomUUID()}\n`
    const name = probeName()
    const { objectKey } = buildObjectKey({
      folder: 'Public/public',
      sourceFileName: 'acl-probe.txt',
      fixedName: name,
      now: new Date(),
    })
    remember(objectKey)

    // 刻意**绕过** upload()：只发 PutObject，不发 PutObjectACL
    const put = prepareOssRequest({
      config: assertOssConfig(liveConfig),
      method: 'PUT',
      objectKey,
      contentType: 'text/plain',
      body: Buffer.from(body, 'utf8'),
    })
    const putResponse = await fetch(put.url, {
      method: put.method,
      headers: put.headers,
      body: Buffer.from(body, 'utf8'),
    })
    expect(putResponse.status).toBe(200)

    // 关键观察点：不设 ACL 时匿名读**不应该**成功
    const beforeAcl = await anonymousGet(put.publicUrl as string)
    expect(beforeAcl.status).not.toBe(200)

    // 补上 ACL，同一个 url 就打开了 —— 前后对照，把"必需"这件事钉死
    await upload.putAcl(objectKey, 'public-read')
    const afterAcl = await anonymousGet(put.publicUrl as string)
    expect(afterAcl.status).toBe(200)
    expect(afterAcl.body).toBe(body)

    expect(await deleteAndGetStatus(objectKey)).toBeLessThan(300)
  })

  it('④ 三步的顺序与请求形状：OSS 认的是"先传字节、再设 ACL"', async () => {
    const name = probeName()
    const { objectKey } = buildObjectKey({
      folder: 'Public/public',
      sourceFileName: 'order-probe.txt',
      fixedName: name,
      now: new Date(),
    })
    remember(objectKey)

    // 反着来：对象还不存在就先设 ACL —— OSS 应当拒绝（而不是"设上了等着"）
    await expect(upload.putAcl(objectKey, 'public-read')).rejects.toThrow(OssRequestError)

    // 正着来：先传字节
    const result = await upload.upload({
      content: Buffer.from('order probe\n', 'utf8'),
      folder: 'Public/public',
      fixedName: name,
      fileName: 'order-probe.txt',
      contentType: 'text/plain',
    })
    expect(result.objectKey).toBe(objectKey)
    expect(result.acl).toBe('public-read')

    expect(await deleteAndGetStatus(objectKey)).toBeLessThan(300)
  })

  it('② ACL 子资源请求（`?acl=` 形态）与 getAcl 在真实 OSS 上走得通', async () => {
    const name = probeName()
    const result = await upload.upload({
      content: Buffer.from('acl subresource probe\n', 'utf8'),
      folder: 'Public/public',
      fixedName: name,
      fileName: 'acl-sub.txt',
      contentType: 'text/plain',
    })
    remember(result.objectKey)

    // getAcl 打的是 GET /{key}?acl=，能读出值就说明这个 URL 形态 OSS 收
    expect(await upload.getAcl(result.objectKey)).toBe('public-read')

    // 改成 private 再读回来 —— 证明读到的**确实是服务端的状态**，不是我们填的那个值
    await upload.putAcl(result.objectKey, 'private')
    expect(await upload.getAcl(result.objectKey)).toBe('private')

    await upload.putAcl(result.objectKey, 'public-read')
    expect(await upload.getAcl(result.objectKey)).toBe('public-read')

    expect(await deleteAndGetStatus(result.objectKey)).toBeLessThan(300)
  })

  it('⑤ deleteMulti 真删多个：OSS 逐个回报，删完全部打不开', async () => {
    // 先真传三个上去（每个都要先能匿名读到，才说明"删之前它是在的"）
    const keys: string[] = []
    const urls: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const name = probeName()
      const result = await upload.upload({
        content: Buffer.from(`batch delete probe ${i}\n`, 'utf8'),
        folder: 'Public/public',
        fixedName: name,
        fileName: 'batch.txt',
        contentType: 'text/plain',
      })
      remember(result.objectKey)
      expect(result.acl).toBe('public-read')
      keys.push(result.objectKey)
      urls.push(result.url)
    }

    // 删之前：三个都能匿名读到（这是"确实有东西可删"的前提）
    for (const url of urls) {
      expect((await anonymousGet(url)).status).toBe(200)
    }

    // ⭐ 走能力的批量删，且 OSS 会逐个回报删掉了哪些
    const outcome = await upload.deleteMulti(keys)
    expect(outcome.errors).toEqual([])
    expect([...outcome.deleted].sort()).toEqual([...keys].sort())

    // 删之后：三个都打不开
    for (const url of urls) {
      expect((await anonymousGet(url)).status).not.toBe(200)
    }
    for (const key of keys) created.delete(key)
  })

  it('清理证据：本次**曾经建过**的对象全部已删除（匿名读都打不开）', async () => {
    // ⚠️ 查的是 everCreated（删了也不移除的那个集合），不是 created。
    // 用 created 的话这里会是个空循环 —— 0ms 通过、一条断言都没跑，是条恒真的假测试。
    // 所以下面先钉住"确实有东西被建过"，让这个用例不可能被清空成空转。
    expect(everCreated.size).toBeGreaterThanOrEqual(4) // ①②③④ 四个用例各建了至少一个

    // 这个用例跑在前面几个之后；afterAll 里还有一层兜底
    const remaining: string[] = []
    const checked: string[] = []
    for (const objectKey of everCreated) {
      checked.push(objectKey)
      const url = buildPublicUrl({
        endpoint: String(liveConfig.endpoint),
        bucket: String(liveConfig.bucket),
        objectKey,
        cname: true,
        secure: true,
      })
      const anon = await anonymousGet(url)
      if (anon.status === 200) remaining.push(objectKey)
    }
    // ⚠️ 这两条是防"空转"的：`checked` 记录循环**真正走过**的元素，
    // 如果哪天循环被改成遍历另一个（更小的）集合，上面那个 size 断言不会发现，
    // 但这一条会发现 —— 反证时抓到过：把循环改回 `created` 时它是绿的。
    expect(checked.length).toBe(everCreated.size)
    expect(checked.length).toBeGreaterThanOrEqual(4)
    expect(remaining, `这些对象没删干净：${remaining.join(', ')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ⑨b LIVE 清理**指定的**遗留对象（默认 skip，且必须显式点名）
//
// 为什么要有它：SDK 在 2026-09-21 之前**没有删除能力**，所以此前用 SDK 传上去的
// 测试产物"没有出口"（真实踩到：调休流程那条线留的 HR/approval/2026/09/xxx.png）。
// 这个入口把"清理遗留"变成可复现的一步。
//
// ⚠️ 安全设计：**必须用 `OSS_CLEANUP_OBJECT_KEY` 显式点名要删哪个键**，
// 一次只删一个。不提供"按前缀批量清"这种入口 —— 桶里有别人的东西，
// 一个能按前缀扫射的删除入口迟早会误伤。
//
// 跑法：
//   OSS_CLEANUP_OBJECT_KEY=HR/approval/2026/09/xxx.png \
//     smoke/with-oss-credentials.sh pnpm exec vitest run test/base-upload.test.ts -t 遗留
// ---------------------------------------------------------------------------

const cleanupKey = process.env.OSS_CLEANUP_OBJECT_KEY

describe.skipIf(!liveReady || !cleanupKey)('LIVE 清理指定的遗留对象（默认 skip，需显式点名）', () => {
  it('删掉 OSS_CLEANUP_OBJECT_KEY 指定的对象，并留下删前/删后证据', async () => {
    const objectKey = String(cleanupKey)
    const upload = createBaseUploadCapability(liveConfig)
    const url = buildPublicUrl({
      endpoint: String(liveConfig.endpoint),
      bucket: String(liveConfig.bucket),
      objectKey,
      cname: true,
      secure: true,
    })

    const before = await fetch(url)
    const beforeBody = await before.text()
    process.stdout.write(
      `[cleanup] 对象 ${objectKey}\n` +
        `[cleanup] 删前匿名 GET = ${before.status}（${beforeBody.length} 字节）\n`,
    )

    const result = await upload.deleteObject(objectKey)
    expect(result.objectKey).toBe(objectKey)

    const after = await fetch(url)
    process.stdout.write(`[cleanup] 删后匿名 GET = ${after.status}\n`)

    // 这一条才是"真的删掉了"的判据 —— deleteObject 是幂等的，它的返回值说明不了问题
    expect(after.status).not.toBe(200)
  })
})
