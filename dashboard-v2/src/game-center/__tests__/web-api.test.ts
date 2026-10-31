import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameWebClient } from '../runtime/web-client'
const identity = { id: 'alice' }
const create = () => new GameWebClient({ getIdentity: () => identity.id, onSessionInvalid: vi.fn() })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
describe('浏览器游戏请求', () => {
  it('真人动作使用REST且保留同一个actionId与Cookie身份绑定', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true, handId: 'h', actionSeq: 1, cursor: '1:1' }))
    const client=create(),params={ roomCode:'1234',actionId:'stable-action' }
    await client.call('app.game.poker.action.act',params)
    expect(fetch).toHaveBeenCalledWith('/api/game/poker/rooms/1234/actions',expect.objectContaining({credentials:'include',body:JSON.stringify({operation:'app.game.poker.action.act',params})}))
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-synapse-game-user-id')).toBe('alice')
    client.dispose()
  })
  it('解析invoke信封并保留服务端错误详情', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({ok:false,failure:{code:'POKER_ILLEGAL_ACTION',message:'非法动作',legalActions:['fold']}}))
    const client=create()
    await expect(client.call('app.game.poker.room.create',{})).rejects.toMatchObject({code:'POKER_ILLEGAL_ACTION',details:{legalActions:['fold']}})
    client.dispose()
  })
  it('损坏JSON不回显私密响应', async () => {
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{"persona":"secret" broken'))
    const client=create()
    await expect(client.call('app.game.hall.overview',{})).rejects.toMatchObject({code:'GAME_INVALID_RESPONSE',details:{}})
    client.dispose()
  })
  it('30秒超时结束调用，即使底层请求未响应取消', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(()=>{}))
    const client=create(),result=client.call('app.game.hall.overview',{}).catch(error=>error)
    await vi.advanceTimersByTimeAsync(30000)
    expect(await result).toMatchObject({name:'AbortError'})
    client.dispose()
  })
  it('身份变更立即取消调用者等待，不接受旧响应', async () => {
    vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(()=>{}))
    const client=create(),result=client.call('app.game.hall.overview',{}).catch(error=>error)
    client.identityChanged()
    expect(await result).toMatchObject({code:'GAME_IDENTITY_CHANGED'})
    client.dispose()
  })
  it('Web UI不提供MCP专用控制操作', async () => {
    const client=create()
    await expect(client.call('app.game.poker.control.claim',{})).rejects.toMatchObject({code:'GAME_UNKNOWN_OPERATION'})
    client.dispose()
  })
})
