#!/usr/bin/env node
// Run only through the explicitly authorized test-session wrapper. Never print credentials/errors wholesale.
import assert from 'node:assert/strict'
import { createPortalHeadless } from '../dist/index.js'
const { PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId } = process.env
assert.equal(baseUrl, 'https://biz-api-test.wodecorp.cn')
assert(token && tenantId, 'Test session required')
const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId }, timeoutMs: 30000 })
const report = (step, result) => process.stdout.write(JSON.stringify({ step, ...result }) + '\n')
const mode = process.argv[2] || 'read'
async function allSheets(query, archived = false) {
  const rows = []
  for (let pageNo = 1; ; pageNo++) {
    const page = await (archived ? sdk.attendanceArchive : sdk.attendanceStatistics).list({ ...query, pageNo, pageSize: 100 })
    rows.push(...page.list)
    if (rows.length >= page.total || page.list.length === 0) return rows
  }
}
try {
  if (mode === 'unit') {
    const unitName = `T${Date.now().toString(36)}`.slice(-10)
    report('unit-prepare', { unitName })
    const before = await sdk.platformMaterialUnit.list({ unitName })
    report('unit-name-available', { total: before.total })
    assert.equal(before.total, 0)
    const { draft } = sdk.platformMaterialUnit.prepareCreate({ unitName, sort: 9999 })
    let id
    try {
      id = await sdk.platformMaterialUnit.create(draft)
      report('unit-created', { id, unitName })
      assert.equal((await sdk.platformMaterialUnit.get(id)).sort, 9999)
      const prepared = await sdk.platformMaterialUnit.prepareUpdate({ id, sort: 9998 })
      assert.equal(await sdk.platformMaterialUnit.update(prepared.draft), true)
      assert.equal((await sdk.platformMaterialUnit.get(id)).sort, 9998)
      await sdk.platformMaterialUnit.update(prepared.previous)
      assert.equal((await sdk.platformMaterialUnit.get(id)).sort, 9999)
      report('unit-edit-and-restore-verified', { id })
    } finally {
      // A timed-out create is reconciled using the unique test name, never retried.
      if (id === undefined) {
        const rows = await sdk.platformMaterialUnit.list({ unitName })
        const exact = rows.list.filter(row => row.unitName === unitName)
        if (exact.length === 1 && rows.total === 1) id = exact[0].id
      }
      if (id !== undefined) {
        await sdk.platformMaterialUnit.remove(id)
        assert.equal(await sdk.platformMaterialUnit.get(id), null)
        assert.equal((await sdk.platformMaterialUnit.list({ unitName })).total, 0)
        report('unit-cleaned', { id })
      }
    }
  } else if (mode === 'hr') {
    const sensitive = await sdk.call('/dashboard/post/post-type/list', { url: '/org/sensitive/info', method: 'get' })
    const removal = { verificationRequired: !((sensitive?.mobile === undefined && sensitive?.isDel === undefined) || sensitive?.isDel === 1) }
    if (removal.verificationRequired) {
      report('hr-write-skipped', { reason: 'SMS verification required; no test record created or SMS sent' })
    } else {
      const name = `SDK-TEST-${Date.now()}`
      report('hr-write-prepared', { name })
      assert.equal((await sdk.hrPostType.list({ name })).total, 0)
      let id
      try {
        await sdk.hrPostType.create({ name, sort: 9999, remark: 'SDK smoke, temporary' })
        const found = (await sdk.hrPostType.list({ name })).list.filter(row => row.name === name)
        assert.equal(found.length, 1)
        id = found[0].id
        assert.equal((await sdk.hrPostType.get({ id })).sort, 9999)
        report('hr-created', { id })
        await sdk.hrPostType.update({ id, name, sort: 9998, remark: 'SDK smoke, temporary' })
        assert.equal((await sdk.hrPostType.get({ id })).sort, 9998)
        report('hr-update-verified', { id })
      } finally {
        if (id === undefined) {
          const exact = (await sdk.hrPostType.list({ name })).list.filter(row => row.name === name)
          if (exact.length === 1) id = exact[0].id
        }
        if (id !== undefined) {
          await sdk.hrPostType.remove({ ids: [id] })
          assert.equal((await sdk.hrPostType.list({ name })).total, 0)
          report('hr-cleaned', { id })
        }
      }
    }
  } else if (mode === 'attendance') {
    const department = await sdk.attendanceSheet.department()
    assert(department.id && department.fullPath)
    const groups = await sdk.attendanceSheet.searchGroups({ departmentId: department.id, keyword: department.fullPath.split('/').at(-1) })
    assert.equal(groups.total, 1, 'Need one unambiguous group from current department')
    const organizationId = groups.list[0].id
    // This pre-existing source is read-only; never edit or delete it.
    const source = await sdk.attendanceSheet.get({ id: 144 })
    assert(source.users.length > 0)
    const query = { departmentId: Number(department.id), organizationId: Number(organizationId) }
    const before = await allSheets(query)
    const previousIds = new Set(before.map(row => String(row.id)))
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const draft = { departmentId: department.id, organizationId, yearMonth, userIdList: [source.users[0].id], requestId: `pc-smoke-${Date.now()}` }
    report('attendance-write-prepared', { departmentId: department.id, organizationId, yearMonth, previousIds: [...previousIds], requestId: draft.requestId })
    let id
    async function locateCreated() {
      const candidates = (await allSheets(query)).filter(row => !previousIds.has(String(row.id)) && Number(row.year) === Number(yearMonth.slice(0, 4)) && Number(row.month) === Number(yearMonth.slice(5)))
      const matches = []
      for (const candidate of candidates) {
        const detail = await sdk.attendanceSheet.get({ id: candidate.id })
        if (detail.users.length === 1 && String(detail.users[0].id) === String(draft.userIdList[0])) matches.push(candidate)
      }
      assert.equal(matches.length, 1, 'Unable to uniquely reconcile this test creation; stop all mutations')
      return matches[0].id
    }
    try {
      await sdk.attendanceSheet.saveIdempotent(draft)
      id = await locateCreated()
      report('attendance-created', { id })
      const detail = await sdk.attendanceSheet.get({ id })
      assert.equal(detail.yearMonth, yearMonth)
      assert.equal(String(detail.departmentId), String(department.id))
      assert.equal(String(detail.organizationId), String(organizationId))
      const snapshot = (await allSheets(query)).find(row => String(row.id) === String(id))
      assert.equal(snapshot.isArchived, 0)
      await sdk.attendanceSheet.saveIdempotent({ ...draft, id, isArchived: snapshot.isArchived, requestId: `${draft.requestId}-edit` })
      assert.deepEqual((await sdk.attendanceSheet.get({ id })).users.map(row => row.id), draft.userIdList)
      const statistics = await sdk.attendanceSheet.statistics({ id, isArchived: snapshot.isArchived })
      report('attendance-edit-statistics-verified', { id, statisticsCount: statistics.length })
      await sdk.attendanceSheet.archive({ id, isArchived: snapshot.isArchived })
      assert.equal((await allSheets(query)).find(row => String(row.id) === String(id)).isArchived, 1)
      assert((await allSheets(query, true)).some(row => String(row.id) === String(id)))
      await sdk.attendanceSheet.statistics({ id, isArchived: 1 })
      report('attendance-archive-verified', { id })
    } finally {
      if (id === undefined) {
        const after = await allSheets(query)
        if (after.some(row => !previousIds.has(String(row.id)))) id = await locateCreated()
      }
      if (id !== undefined) {
        let row = (await allSheets(query)).find(row => String(row.id) === String(id))
        if (row?.isArchived === 1) {
          await sdk.attendanceSheet.unarchive({ id })
          row = (await allSheets(query)).find(row => String(row.id) === String(id))
          assert.equal(row.isArchived, 0)
          assert(!(await allSheets(query, true)).some(item => String(item.id) === String(id)))
          report('attendance-unarchive-verified', { id })
        }
        assert(row, 'Created row missing before cleanup; reconcile before delete')
        await sdk.attendanceSheet.remove({ id, isArchived: row.isArchived })
        assert(!(await allSheets(query)).some(row => String(row.id) === String(id)))
        report('attendance-cleaned', { id })
      }
    }
  } else if (mode === 'attendance-prepare') {
    const department = await sdk.attendanceSheet.department()
    const source = await sdk.attendanceSheet.get({ id: 144 })
    const groups = await sdk.attendanceSheet.searchGroups({ departmentId: department.id, keyword: department.fullPath.split('/').at(-1) })
    report('attendance-prepare', { departmentId: department.id, sourceId: source.id, sourceDepartment: source.departmentId, sourceGroup: source.organizationId, sourceMemberCount: source.users.length, groups: groups.list.map(({id}) => ({id})) })
  } else {
    const department = await sdk.attendanceSheet.department()
    report('attendance-department', { id: department.id })
    const users = await sdk.attendanceSheet.searchUsers({ keyword: '李', pageSize: 5 })
    report('attendance-users', { count: users.list.length, total: users.total })
    const listed = await sdk.attendanceStatistics.list({ departmentId: department.id, pageSize: 100 })
    report('attendance-existing', { total: listed.total, rows: listed.list.map(({ id, isArchived, year, month, organizationId }) => ({ id, isArchived, year, month, organizationId })) })
    const posts = await sdk.hrPostType.list({ pageSize: 1 })
    report('hr-list', { total: posts.total })
  }
} catch (error) {
  // Axios configs can contain auth headers: do not serialize the error or request object.
  report('failed', { type: error?.name || 'Error', code: error?.code ?? null, message: error?.name === 'PortalApiError' ? error.message.split(token).join('<redacted>') : undefined, assertion: error?.code === 'ERR_ASSERTION' ? error.message : undefined })
  process.exitCode = 1
}
