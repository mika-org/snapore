"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Aperture,
  ChartNoAxesCombined,
  Frame,
  Images,
  LayoutDashboard,
  MonitorCog,
  LogOut,
  Settings2,
  Sparkles,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: Images },
  { href: "/admin", label: "Frames & layout", icon: Frame },
  { href: "/admin#devices", label: "Devices", icon: MonitorCog },
  { href: "/admin#pricing", label: "Pricing", icon: ChartNoAxesCombined },
  { href: "/admin#settings", label: "Settings", icon: Settings2 },
];

type Workspace = {
  name: string;
  code: string | null;
  userName: string;
  userRole: string;
  kioskUrl: string | null;
  boothStatus: "ONLINE" | "OFFLINE" | "DEGRADED" | "MAINTENANCE" | null;
  lastHeartbeatLabel: string | null;
};

export function AppShell({ children, workspace }: { children: React.ReactNode; workspace: Workspace }) {
  const pathname = usePathname();
  const defaultNavigation = navigation.find((item) => item.href.split("#")[0] === pathname)?.href ?? "/";
  const [selectedNavigation, setSelectedNavigation] = useState(defaultNavigation);
  const boothOnline = workspace.boothStatus === "ONLINE";
  const boothStatusLabel = workspace.boothStatus
    ? workspace.boothStatus.charAt(0) + workspace.boothStatus.slice(1).toLowerCase()
    : "Belum ada booth";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Snapore overview">
          <span className="brand-mark"><Aperture size={22} strokeWidth={2.8} /></span>
          <span>SNAPORE</span>
        </Link>

        <div className="workspace-switcher">
          <div className="workspace-avatar">{workspace.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{workspace.name}</strong>
            <span>{workspace.code ?? "Belum ada booth"}</span>
          </div>
          <span className={boothOnline ? "online-pip" : "online-pip offline"} aria-label={boothStatusLabel} />
        </div>

        <nav className="nav-list" aria-label="Navigasi utama">
          <span className="nav-label">Workspace</span>
          {navigation.map(({ href, label, icon: Icon }) => {
            const baseHref = href.split("#")[0];
            const active = baseHref === "/"
              ? pathname === "/"
              : pathname.startsWith(baseHref) && selectedNavigation === href;
            return (
              <Link className={active ? "nav-item active" : "nav-item"} href={href} key={href} onClick={() => setSelectedNavigation(href)}>
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="agent-card">
          <span className="status-line"><span className={`status-dot ${boothOnline ? "online" : workspace.boothStatus === "DEGRADED" ? "warn" : ""}`} />Status booth</span>
          <strong>{boothStatusLabel}</strong>
          <small>{workspace.lastHeartbeatLabel ?? "Belum pernah mengirim heartbeat"}</small>
        </div>
        {workspace.kioskUrl ? (
          <Link className="kiosk-launch" href={workspace.kioskUrl}>
            <Sparkles size={18} />
            Open kiosk
          </Link>
        ) : null}
        <div className="operator-card">
          <div className="operator-avatar">{workspace.userName.slice(0, 2).toUpperCase()}</div>
          <div><strong>{workspace.userName}</strong><span>{workspace.userRole}</span></div>
          <form action="/api/auth/logout" method="post"><button type="submit" aria-label="Logout"><LogOut size={15} /></button></form>
        </div>
      </aside>
      <main className="main-panel">{children}</main>
    </div>
  );
}
