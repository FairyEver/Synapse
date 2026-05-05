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
  KeyRoundIcon,
  MonitorIcon,
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
      title: "激活码",
      url: "#/activation-codes",
      icon: (
        <KeyRoundIcon
        />
      ),
    },
    {
      title: "账号",
      url: "#/accounts",
      icon: (
        <UsersIcon
        />
      ),
    },
    {
      title: "设备",
      url: "#/devices",
      icon: (
        <MonitorIcon
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
