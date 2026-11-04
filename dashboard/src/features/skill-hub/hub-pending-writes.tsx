import { Button, toast } from '@heroui/react'
import { useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { assertHubSession } from './skill-hub-api'
import { checkHubIntent, getHubIntentRevision, listHubIntents, subscribeHubIntents } from './use-skill-publish'
import { hubScope } from './use-skill-hub'

const labels = {
  'app.skill_hub.skill.create': '上传 Skill',
  'app.skill_hub.version.create': '上传新版本',
  'app.skill_hub.skill.update': '编辑资料',
  'app.skill_hub.skill.delete': '删除 Skill',
} as const

export function HubPendingWrites({ session }: { session: string }) {
  const cache = useQueryClient()
  const [checking, setChecking] = useState<string>()
  useSyncExternalStore(subscribeHubIntents, getHubIntentRevision, () => 0)
  const items = listHubIntents(session)
  if (!items.length) return null

  async function check(item: typeof items[number]) {
    if (checking) return
    setChecking(item.key)
    try {
      const result = await checkHubIntent(session, item)
      assertHubSession(session)
      if (result.state === 'committed') {
        toast.success('操作已提交')
        void cache.invalidateQueries({ queryKey: hubScope(session) })
      } else toast.info('尚未确认写入结果，请稍后再查。')
    } catch { /* The old session cannot report an outcome in the new one. */ }
    finally { setChecking(undefined) }
  }

  return <section aria-label="待确认的 Skill 操作" className="space-y-2 border-b border-separator pb-4">
    <p className="text-sm font-medium">待确认的操作</p>
    <ul className="space-y-2">{items.map((item) => <li key={item.key} className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">{labels[item.request.action]}</span>
      <Button variant="secondary" isDisabled={!!checking && checking !== item.key} isPending={checking === item.key}
        onPress={() => void check(item)}>查询回执</Button>
    </li>)}</ul>
  </section>
}
