import type { Permission } from '@nexa/shared';
import {
  Activity,
  Bot,
  Database,
  Gauge,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  Wrench,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Bot;
  permission?: Permission;
}

/** Only implemented pages appear here. Later phases (workflows, knowledge, approvals) are added when built. */
export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    section: 'Build',
    items: [
      { href: '/agents', label: 'Agents', icon: Bot, permission: 'agents:read' },
      { href: '/tools', label: 'Tools', icon: Wrench, permission: 'tools:read' },
    ],
  },
  {
    section: 'Operate',
    items: [
      { href: '/executions', label: 'Executions', icon: Activity, permission: 'executions:read' },
      { href: '/records', label: 'Business data', icon: Database, permission: 'records:read' },
    ],
  },
  {
    section: 'Govern',
    items: [
      { href: '/usage', label: 'Usage & cost', icon: Gauge, permission: 'usage:read' },
      { href: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
      { href: '/members', label: 'Members', icon: Users, permission: 'members:read' },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];
