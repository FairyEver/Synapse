"use client"

import * as React from "react"

import synapseLogo from "@/assets/icon.png"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  ActivityIcon,
  FileTextIcon,
  HardDriveIcon,
  LinkIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react"

const data = {
  teams: [
    {
      name: "Synapse",
      logo: synapseLogo,
      plan: "Dashboard",
    },
  ],
  navMain: [
    {
      title: "用户",
      url: "#/users",
      icon: (
        <UsersIcon
        />
      ),
    },
    {
      title: "团队",
      url: "#/teams",
      icon: (
        <UsersIcon
        />
      ),
    },
    {
      title: "邀请",
      url: "#/invitations",
      icon: (
        <LinkIcon
        />
      ),
    },
    {
      title: "审计日志",
      url: "#/audit-logs",
      icon: (
        <ScrollTextIcon
        />
      ),
    },
    {
      title: "系统",
      url: "#/system",
      icon: (
        <ActivityIcon
        />
      ),
    },
    {
      title: "备份管理",
      url: "#/backup",
      icon: (
        <HardDriveIcon
        />
      ),
    },
    {
      title: "系统日志",
      url: "#/logs",
      icon: (
        <FileTextIcon
        />
      ),
    },
  ],
}

export function AppSidebar({
  activeRoute,
  user,
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  readonly activeRoute: string
  readonly user: {
    name: string
    email: string
    avatar: string
  }
  readonly onLogout: () => void
}) {
  const items = data.navMain.map((item) => ({
    ...item,
    isActive: item.url === `#/${activeRoute}`,
  }))

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
