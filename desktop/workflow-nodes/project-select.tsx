import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SynapseProjectConfig } from "@/types/config"

export interface ProjectSelectProps {
  value?: string
  onChange: (id: string | undefined) => void
  projects: readonly SynapseProjectConfig[]
  placeholder?: string
}

const INHERIT_VALUE = "__inherit__"

export function ProjectSelect({ value, onChange, projects, placeholder = "继承默认" }: ProjectSelectProps) {
  return (
    <Select
      value={value ?? INHERIT_VALUE}
      onValueChange={(v) => onChange(v === INHERIT_VALUE ? undefined : v)}
    >
      <SelectTrigger className="w-full h-7 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={INHERIT_VALUE}>{placeholder}</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
