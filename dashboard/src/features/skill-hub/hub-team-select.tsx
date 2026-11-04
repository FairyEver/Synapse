import { Label, ListBox, Select } from '@heroui/react'
import type { SkillHubTeam } from '@synapse/shared/skill-hub-contracts'

export function HubTeamSelect({ value, onChange, teams, all, variant = 'primary', disabled = false }: {
  value?: string; onChange: (id?: string) => void; teams: SkillHubTeam[]; all?: boolean
  variant?: 'primary' | 'secondary'; disabled?: boolean
}) {
  const choices = all ? [{ id: 'all-teams', name: '全部团队' }, ...teams] : teams
  return <Select variant={variant} selectedKey={value ?? (all ? 'all-teams' : null)} isDisabled={disabled}
    className="min-w-0" placeholder="选择团队"
    onSelectionChange={(key) => onChange(typeof key === 'string' && key !== 'all-teams' ? key : undefined)}>
    <Label>团队</Label>
    <Select.Trigger><Select.Value className="min-w-0 truncate" /><Select.Indicator /></Select.Trigger>
    <Select.Popover>
      <ListBox items={choices}>
        {(team) => <ListBox.Item id={team.id} textValue={team.name}>
          <span className="min-w-0 truncate" title={team.name}>{team.name}</span><ListBox.ItemIndicator />
        </ListBox.Item>}
      </ListBox>
    </Select.Popover>
  </Select>
}
