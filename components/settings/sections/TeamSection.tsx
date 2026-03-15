'use client'

import { Users, UserPlus, Shield, BookOpen, Link2, CreditCard, Construction } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'

// Demo member data
const DEMO_MEMBERS = [
  { id: '1', name: 'You (owner)', email: 'you@studio.com', role: 'Admin', initials: 'YO', isYou: true },
]

const ROLES = [
  {
    name: 'Admin',
    description: 'Full access — manage billing, members, integrations, and all projects.',
    icon: Shield,
  },
  {
    name: 'Member',
    description: 'Can create and edit projects, run tools, and access shared resources.',
    icon: Users,
  },
  {
    name: 'Viewer',
    description: 'Read-only access to projects and reports. Cannot run tools or edit.',
    icon: BookOpen,
  },
]

const COMING_SOON_FEATURES = [
  { id: 'shared-integrations', label: 'Shared Integrations', desc: 'Team-wide Speckle and API key management.', icon: Link2 },
  { id: 'firm-knowledge', label: 'Firm Knowledge Base', desc: 'Shared document library and standards for RAG.', icon: BookOpen },
  { id: 'shared-billing', label: 'Shared Billing', desc: 'Centralized billing with per-seat pricing.', icon: CreditCard },
]

function ComingSoonBadge() {
  return (
    <Badge
      variant="outline"
      className="border-archai-graphite/60 py-0 text-[10px] text-muted-foreground/70"
    >
      Coming soon
    </Badge>
  )
}

export function TeamSection() {
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Team &amp; Organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Collaborate with your firm and manage shared workspace resources
        </p>
      </div>

      {/* Coming soon banner */}
      <div className="flex items-start gap-3 rounded-lg border border-archai-orange/20 bg-archai-orange/5 px-4 py-4">
        <Construction className="h-5 w-5 text-archai-orange mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-archai-orange">Team features are coming soon</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Multi-user workspaces, role management, and shared firm resources are in development.
            The structure below shows the planned experience.
          </p>
        </div>
      </div>

      {/* Members */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Members</CardTitle>
              <CardDescription className="mt-1">People with access to this workspace.</CardDescription>
            </div>
            <Button variant="outline" size="sm" disabled className="gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              Invite member
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-archai-graphite">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-archai-graphite bg-archai-graphite/20">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">User</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Email</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Role</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_MEMBERS.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px]">{member.initials}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-white">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{member.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant="archai" className="text-[10px] py-0">{member.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" className="text-xs" disabled>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground/60">
            Member invitations and management will be available when team plans launch.
          </p>
        </CardContent>
      </Card>

      {/* Roles & Permissions */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Roles &amp; Permissions</CardTitle>
              <CardDescription className="mt-1">
                Planned roles for team workspaces.
              </CardDescription>
            </div>
            <ComingSoonBadge />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {ROLES.map(({ name, description, icon: Icon }) => (
            <div
              key={name}
              className="flex items-start gap-3 rounded-md border border-archai-graphite/50 bg-archai-graphite/10 px-4 py-3 opacity-70"
            >
              <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">{name}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Shared Resources */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Shared Workspace Resources</CardTitle>
            <ComingSoonBadge />
          </div>
          <CardDescription>
            Firm-wide settings, integrations, and knowledge available to all members.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {COMING_SOON_FEATURES.map(({ id, label, desc, icon: Icon }) => (
            <div
              key={id}
              className="flex items-start justify-between gap-4 rounded-md border border-archai-graphite/50 bg-archai-graphite/10 px-4 py-3 opacity-60"
            >
              <div className="flex items-start gap-3">
                <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" disabled className="shrink-0">
                Configure
              </Button>
            </div>
          ))}
          <Separator className="bg-archai-graphite" />
          <p className="text-[11px] text-muted-foreground/60">
            Shared resources become available once your workspace has more than one member.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
