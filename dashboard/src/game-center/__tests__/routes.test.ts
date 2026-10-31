import { describe, expect, it } from 'vitest'
import { parseGamePath, gamePath, isGameRedirect } from '../runtime/routes'
describe('独立游戏地址',()=>{
  it.each(['/game/','/game/poker','/game/poker/1234','/game/poker/records','/game/poker/agents'])('规范路由往返%s',(path)=>{
    const route=parseGamePath(path)
    expect(route).not.toBeNull()
    expect(gamePath(route!)).toBe(path)
    expect(isGameRedirect(path)).toBe(true)
  })
  it.each(['//evil.test/game/','https://evil.test/game/','/game/poker/../1234','/game/poker/%2f','/game/other','/console/game','/game/poker/1234/actions'])('拒绝非法路径%s',path=>{
    expect(isGameRedirect(path)).toBe(false)
    expect(parseGamePath(path)).toBeNull()
  })
})
