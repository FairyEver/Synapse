"use client"

import * as React from "react"

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
  GalleryVerticalEndIcon,
  KeyRoundIcon,
  MonitorIcon,
  UsersIcon,
} from "lucide-react"

const data = {
  user: {
    name: "Admin",
    email: "admin@example.com",
    avatar: "",
  },
  teams: [
    {
      name: "Synapse",
      logo: (
        <GalleryVerticalEndIcon
        />
      ),
      plan: "License",
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
      isActive: true,
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
      title: "系统",
      url: "#/system",
      icon: (
        <ActivityIcon
        />
      ),
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
