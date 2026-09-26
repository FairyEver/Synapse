import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import { createPerfManageConfigCapability } from '../src/capabilities/perf-manage-config.js'

describe('绩效配置写能力：Portal 表单与 multipart 请求形状', () => {
  type Call = Parameters<PortalRequest>[0]

  function fakeCapability () {
    const calls: Call[] = []
    const request: PortalRequest = async <T>(config: Call) => {
      calls.push(config)
      if (config.url?.endsWith('/kpitarget/import')) return [] as T
      if (config.url?.endsWith('/formula/definition/save-and-publish')) return { id: 'revision-1' } as T
      return undefined as T
    }
    const cap = createPerfManageConfigCapability(request, request, request, request, request, request)
    return { calls, cap }
  }

  const file = (fileName = 'upload.xlsx') => ({
    fileName,
    base64: Buffer.from('file-bytes').toString('base64'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  it('公式保存固定 Portal 发布备注，取消不发请求', async () => {
    const { calls, cap } = fakeCapability()
    const prepared = cap.prepareFormulaDefinitionSave({
      formulaName: '  绩效公式  ',
      taskType: 3,
      configJson: '{"a":1}',
      astJson: '{"type":"number"}',
      description: null,
    })
    expect(prepared.draft).toMatchObject({
      formulaName: '绩效公式',
      description: '',
      publishRemark: 'Web 保存公式并发布新修订',
    })
    expect(cap.cancelFormulaDefinitionSave()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)
    await cap.saveAndPublishFormulaDefinition({ draft: prepared.draft })
    expect(calls[0]).toMatchObject({
      url: '/infra/formula/definition/save-and-publish',
      method: 'post',
      data: prepared.draft,
    })
    expect(Object.keys(calls[0]?.data as object)).toEqual([
      'formulaName', 'taskType', 'configJson', 'astJson', 'description', 'publishRemark',
    ])
  })

  it('五险一金编辑页按模式分别 POST/PUT /sys/user，取消只丢弃本地草稿', async () => {
    const { calls, cap } = fakeCapability()
    const form = {
      name: '张三',
      idcard: '110101199001010011',
      personalFund: 100,
      personalInsurance: 200,
      companyFund: 300,
      companyInsurance: 400,
    }
    const create = cap.prepareInsuranceFundCreate(form)
    expect(cap.cancelInsuranceFundCreate()).toEqual({ cancelled: true })
    await cap.createInsuranceFund(create)
    expect(calls[0]).toMatchObject({ url: '/sys/user', method: 'post', data: form })

    const update = cap.prepareInsuranceFundUpdate({ ...form, id: '7' })
    expect(cap.cancelInsuranceFundUpdate()).toEqual({ cancelled: true })
    await cap.updateInsuranceFund(update)
    expect(calls[1]).toMatchObject({ url: '/sys/user', method: 'put', data: { ...form, id: '7' } })
    expect(() => cap.prepareInsuranceFundUpdate({ ...form, id: '' as never })).toThrow(/记录ID/)
    expect(() => cap.prepareInsuranceFundCreate({ ...form, personalFund: Number.NaN })).toThrow(/有限数字/)
  })

  it('指标导入 FormData 顺序为 file/type/parentId，启停为取反后的 status', async () => {
    const { calls, cap } = fakeCapability()
    const prepared = cap.prepareIndicatorImport({ ...file(), type: 2, parentId: '' })
    expect(prepared.parentId).toBe('')
    await cap.importIndicators({ ...file(), type: 2, parentId: '' })
    const entries = Array.from((calls[0]?.data as FormData).entries())
    expect(entries.map(([name]) => name)).toEqual(['file', 'type', 'parentId'])
    expect(entries[1]?.[1]).toBe('2')
    expect(entries[2]?.[1]).toBe('')
    expect(calls[0]?.headers).toMatchObject({ 'Content-Type': 'multipart/form-data' })

    await cap.updateIndicatorStatus({ draft: cap.prepareIndicatorStatus({ id: '7', dataType: 2, currentStatus: 1 }).draft })
    expect(calls[1]).toMatchObject({
      url: '/performance/basedata/kpitarget/updateStatus',
      method: 'put',
      data: { id: '7', status: 0 },
    })
    expect(() => cap.prepareIndicatorStatus({ id: '7', dataType: 1, currentStatus: 1 })).toThrow(/dataType=2/)
  })

  it('指标/标准删除分别发对象/裸数组，五险一金上传不额外收紧 Portal 文件选择器', async () => {
    const { calls, cap } = fakeCapability()
    await cap.deleteIndicators({ draft: cap.prepareIndicatorDelete({ ids: ['1', '2'] }).draft })
    await cap.deleteInsuranceFunds({ draft: cap.prepareInsuranceDelete({ ids: ['3'] }).draft })
    await cap.importInsuranceFunds({ fileName: 'fund.csv', base64: Buffer.from('x').toString('base64'), contentType: 'text/csv' })
    await cap.importStandards({ ...file(), type: 0, parentId: '' })
    await cap.deleteStandards({ draft: cap.prepareStandardDelete({ ids: ['4'] }).draft })

    expect(calls[0]).toMatchObject({ method: 'delete', url: '/performance/basedata/kpitarget', data: { ids: ['1', '2'] } })
    expect(calls[1]).toMatchObject({ method: 'delete', url: '/performance/basedata/hrinsurancefund', data: ['3'] })
    expect(Array.from((calls[2]?.data as FormData).entries()).map(([name]) => name)).toEqual(['file'])
    expect(calls[3]).toMatchObject({ method: 'post', url: '/performance/kpistandard/import' })
    expect(Array.from((calls[3]?.data as FormData).entries()).map(([name]) => name)).toEqual(['file', 'type', 'parentId'])
    expect(calls[4]).toMatchObject({ method: 'delete', url: '/performance/kpistandard', data: ['4'] })
  })
})
