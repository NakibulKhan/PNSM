import {
  LayoutDashboard,
  Users,
  MapPin,
  ClipboardList,
  FileBarChart,
  Settings,
  ShieldAlert,
  CalendarDays,
  Map as MapIcon,
  ScrollText,
  Receipt,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react';
import type { Permission } from '@/lib/rbac';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
  /** Rendered as a live count badge when non-zero. */
  badgeKey?: 'flagged' | 'leave';
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * The first group reproduces wireframe Fig 3.4 exactly — Dashboard, Employees,
 * Geofences, Attendance Logs, Reports, Settings — because that is the agreed
 * information architecture in the proposal. Everything the wireframe did not
 * name is grouped separately rather than smuggled into the primary rail.
 */
export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:view' },
      { href: '/employees', label: 'Employees', icon: Users, permission: 'employee:read' },
      { href: '/geofences', label: 'Geofences', icon: MapPin, permission: 'geofence:read' },
      { href: '/attendance', label: 'Attendance Logs', icon: ClipboardList, permission: 'attendance:read' },
      { href: '/reports', label: 'Reports', icon: FileBarChart, permission: 'report:export' },
      { href: '/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
    ],
  },
  {
    label: 'Review queue',
    items: [
      {
        href: '/flagged',
        label: 'Flagged check-ins',
        icon: ShieldAlert,
        permission: 'attendance:review',
        badgeKey: 'flagged',
      },
      {
        href: '/leave',
        label: 'Leave requests',
        icon: CalendarDays,
        permission: 'leave:read',
        badgeKey: 'leave',
      },
      { href: '/live-map', label: 'Live map', icon: MapIcon, permission: 'livemap:view' },
    ],
  },
  {
    label: 'Super Admin',
    items: [
      { href: '/admins', label: 'Admin accounts', icon: UserCog, permission: 'admin:manage' },
      { href: '/policy', label: 'Global policy', icon: SlidersHorizontal, permission: 'policy:write' },
      { href: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
      { href: '/billing', label: 'Billing', icon: Receipt, permission: 'billing:read' },
    ],
  },
];
