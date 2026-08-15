/* eslint-disable @next/next/no-img-element -- authenticated asset route streams private session photos */
"use client";

import {
  Aperture,
  BarChart3,
  Building2,
  CalendarRange,
  Camera,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  Download,
  FlaskConical,
  ImagePlus,
  Images,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MapPin,
  Monitor,
  Pencil,
  Power,
  Printer,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Store,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  XCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { FrameManager } from "@/components/frame-manager";
import { SearchableSelect } from "@/components/searchable-select";
import { SessionGalleryPreview } from "@/components/session-gallery-preview";
import { formatCurrency } from "@/lib/format";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  status: string;
  taxRate: number;
  pricesIncludeTax: boolean;
  defaultPrintCost: number;
  paymentFeeRate: number;
  paymentFeeFixed: number;
  counts: { users: number; booths: number; frames: number };
  payment: { enabled: boolean; environment: "TEST" | "LIVE"; apiKeyMasked: string | null; webhookTokenMasked: string | null };
};

type ManagedUser = { id: string; tenantId: string | null; name: string; email: string; role: string; active: boolean };

type Booth = {
  id: string;
  tenantId: string;
  tenant: string;
  code: string;
  name: string;
  location: string | null;
  timezone: string;
  status: string;
  lastHeartbeatAt: string | null;
  kioskEnabled: boolean;
  voiceEnabled: boolean;
  maintenanceMode: boolean;
  resourceReady: boolean;
  readinessReason: string | null;
  layoutCounts: number[];
  kioskUrl: string;
  devices: Array<{ id: string; name: string; type: string; status: string; preferred: boolean; driverName: string | null; firmware: string | null; lastSeenAt: string | null }>;
};

type Overview = {
  tenants: Tenant[];
  users: ManagedUser[];
  booths: Booth[];
  sessions: Array<{
    id: string;
    publicCode: string;
    tenantId: string;
    tenant: string;
    boothId: string;
    booth: string;
    boothCode: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    layout: string | null;
    frame: string | null;
    photoCount: number;
    copies: number;
    total: number;
    paymentStatus: string;
    paymentProvider: string | null;
    sessionKind: "TESTING" | "PRODUCTION";
    testingReason: string | null;
    uploadStatus: string | null;
    galleryAvailable: boolean;
    assets: Array<{ id: string; kind: string; mimeType: string; byteSize: number; slotIndex: number | null }>;
    resettable: boolean;
    activeReset: { code: string | null; expiresAt: string; reason: string | null } | null;
  }>;
  sales: Array<{ tenant: string; booth: string; device: string; orders: number; prints: number; gross: number; tax: number; printCost: number; paymentFee: number; netProfit: number }>;
  salesSummary: { excludedTestingOrders: number };
};

type AdminView = "overview" | "create-tenant" | "tenants" | "users" | "booths" | "sessions" | "payments" | "sales";
type PhotoResultFilter = "ALL" | "SUCCESS" | "FAILED";
type SessionKindFilter = "ALL" | "PRODUCTION" | "TESTING";

const emptyOverview: Overview = { tenants: [], users: [], booths: [], sessions: [], sales: [], salesSummary: { excludedTestingOrders: 0 } };

const timezoneOptions = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore"].map((value) => ({ value, label: value }));

const menuItems: Array<{ id: AdminView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "create-tenant", label: "Tambah tenant", icon: Plus },
  { id: "tenants", label: "Daftar tenant", icon: Building2 },
  { id: "users", label: "User accounts", icon: Users },
  { id: "booths", label: "Booth & kiosk", icon: Monitor },
  { id: "sessions", label: "Sessions & reset", icon: Images },
  { id: "payments", label: "Payment & pajak", icon: CreditCard },
  { id: "sales", label: "Sales & profit", icon: BarChart3 },
];

const viewCopy: Record<AdminView, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "Global operations", title: "Command overview", description: "Pantau tenant, booth, transaksi, pajak, dan laba bersih dalam satu ringkasan." },
  "create-tenant": { eyebrow: "Tenant onboarding", title: "Tambah tenant", description: "Buat workspace bisnis baru sebelum menambahkan user, booth, frame, dan konfigurasi pembayaran." },
  tenants: { eyebrow: "Tenant directory", title: "Semua tenant", description: "Buka workspace setiap tenant dan lihat kepemilikan user, booth, serta frame." },
  users: { eyebrow: "Identity & access", title: "User accounts", description: "Tambahkan akun global atau akun yang hanya memiliki akses ke satu tenant." },
  booths: { eyebrow: "Device network", title: "Booth & kiosk", description: "Kelola identitas kiosk, kesiapan resource, koneksi perangkat, dan tautan operasional setiap booth." },
  sessions: { eyebrow: "Session recovery", title: "Sessions & reset", description: "Pisahkan sesi production dan testing per tenant, kiosk, serta rentang waktu; buat kode pemulihan bila diperlukan." },
  payments: { eyebrow: "Finance controls", title: "Payment & pajak", description: "Atur Xendit QRIS, biaya cetak, fee pembayaran, dan pajak untuk setiap tenant." },
  sales: { eyebrow: "Profitability", title: "Sales & profit", description: "Pisahkan omzet dan laba bersih berdasarkan tenant, booth, serta perangkat printer." },
};

function formObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function photoSessionOutcome(status: string) {
  if (status === "COMPLETED") return "SUCCESS" as const;
  if (["FAILED", "CANCELLED", "EXPIRED"].includes(status)) return "FAILED" as const;
  return "IN_PROGRESS" as const;
}

function groupBoothDevices(devices: Booth["devices"]) {
  const grouped = new Map<string, Booth["devices"][number] & { instances: number }>();
  for (const device of devices) {
    const key = `${device.type}:${device.name.trim().toLowerCase()}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...device, instances: 1 });
      continue;
    }
    const preferredDevice = current.status !== "ONLINE" && device.status === "ONLINE" ? device : current;
    grouped.set(key, { ...preferredDevice, preferred: current.preferred || device.preferred, instances: current.instances + 1 });
  }
  return Array.from(grouped.values());
}

function dateRangeQuery(range: { from: string; to: string }) {
  const query = new URLSearchParams();
  if (range.from) query.set("from", new Date(range.from).toISOString());
  if (range.to) query.set("to", new Date(range.to).toISOString());
  return query.toString();
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`Server tidak mengirim respons (${response.status}).`);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Respons server tidak valid (${response.status}).`);
  }
}

export function SuperAdminConsole({ name }: { name: string }) {
  const [data, setData] = useState<Overview>(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AdminView>("overview");
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editingBooth, setEditingBooth] = useState<Booth | null>(null);
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);
  const [sessionTenantId, setSessionTenantId] = useState("");
  const [sessionBoothId, setSessionBoothId] = useState("");
  const [sessionKindFilter, setSessionKindFilter] = useState<SessionKindFilter>("ALL");
  const [photoResultFilter, setPhotoResultFilter] = useState<PhotoResultFilter>("ALL");
  const [dateDraft, setDateDraft] = useState({ from: "", to: "" });
  const [appliedDateRange, setAppliedDateRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = dateRangeQuery(appliedDateRange);
      const response = await fetch(`/api/super-admin${query ? `?${query}` : ""}`, { cache: "no-store" });
      const payload = await readJsonResponse<Overview & { error?: string; detail?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Data gagal dimuat.");
      setData(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Data gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, [appliedDateRange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const send = async (action: Record<string, unknown>, label: string) => {
    setSaving(label);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/super-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const payload = await readJsonResponse<{ error?: string; message?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Penyimpanan gagal.");
      setMessage(payload.message ?? "Perubahan berhasil disimpan.");
      await load();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Penyimpanan gagal.");
      return false;
    } finally {
      setSaving(null);
    }
  };

  const submitSimple = (action: string) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formObject(form);
    const ok = await send({ action, ...values, tenantId: values.tenantId || null }, action);
    if (ok) form.reset();
  };

  const totals = useMemo(
    () => data.sales.reduce((result, row) => ({ gross: result.gross + row.gross, tax: result.tax + row.tax, net: result.net + row.netProfit }), { gross: 0, tax: 0, net: 0 }),
    [data.sales],
  );
  const visibleTenants = selectedTenantId ? data.tenants.filter((tenant) => tenant.id === selectedTenantId) : data.tenants;
  const sessionBoothOptions = data.booths.filter((booth) => !sessionTenantId || booth.tenantId === sessionTenantId);
  const visibleSessions = data.sessions.filter((session) => (
    (!sessionTenantId || session.tenantId === sessionTenantId)
    && (!sessionBoothId || session.boothId === sessionBoothId)
    && (sessionKindFilter === "ALL" || session.sessionKind === sessionKindFilter)
  ));
  const testingSessionCount = data.sessions.filter((session) => session.sessionKind === "TESTING").length;
  const productionSessionCount = data.sessions.length - testingSessionCount;
  const completedPhotoSessions = data.sessions.filter((session) => session.sessionKind === "PRODUCTION" && photoSessionOutcome(session.status) !== "IN_PROGRESS");
  const salesPhotoSessions = completedPhotoSessions.filter((session) => photoResultFilter === "ALL" || photoSessionOutcome(session.status) === photoResultFilter);
  const successfulPhotoCount = completedPhotoSessions.filter((session) => photoSessionOutcome(session.status) === "SUCCESS").length;
  const failedPhotoCount = completedPhotoSessions.filter((session) => photoSessionOutcome(session.status) === "FAILED").length;
  const selectedTenant = data.tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;
  const selectedTenantBooths = selectedTenantId
    ? data.booths.filter((booth) => booth.tenantId === selectedTenantId).map((booth) => ({ id: booth.id, code: booth.code, name: booth.name }))
    : [];
  const copy = viewCopy[activeView];
  const appliedDateQuery = dateRangeQuery(appliedDateRange);

  const applyDateFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dateDraft.from && dateDraft.to && new Date(dateDraft.from) > new Date(dateDraft.to)) {
      setError("Waktu mulai tidak boleh melewati waktu selesai.");
      return;
    }
    setError(null);
    setAppliedDateRange({ ...dateDraft });
  };

  const dateRangeFilter = (
    <form className="date-range-filter" onSubmit={applyDateFilter}>
      <span><CalendarRange size={14} /> Rentang waktu</span>
      <label>Mulai<input type="datetime-local" value={dateDraft.from} onChange={(event) => setDateDraft((current) => ({ ...current, from: event.target.value }))} /></label>
      <label>Selesai<input type="datetime-local" value={dateDraft.to} onChange={(event) => setDateDraft((current) => ({ ...current, to: event.target.value }))} /></label>
      <button className="primary-button" type="submit">Terapkan</button>
      <button className="secondary-button" type="button" onClick={() => { setDateDraft({ from: "", to: "" }); setAppliedDateRange({ from: "", to: "" }); }}>Reset</button>
    </form>
  );

  const openView = (view: AdminView) => {
    setActiveView(view);
    setSidebarOpen(false);
    setSelectedTenantId(null);
  };

  const openTenantWorkspace = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setActiveView("payments");
    setSidebarOpen(false);
  };

  const generateResetCode = async (sessionId: string) => {
    const label = `reset-${sessionId}`;
    setSaving(label);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/super-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generateSessionReset", sessionId }),
      });
      const payload = await readJsonResponse<{ code?: string; expiresAt?: string; error?: string }>(response);
      if (!response.ok || !payload.code) throw new Error(payload.error ?? "Kode reset gagal dibuat.");
      setMessage(`Kode reset ${payload.code} berhasil dibuat dan berlaku selama 10 menit.`);
      await load();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Kode reset gagal dibuat.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="super-admin-shell">
      <aside className={`super-admin-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="super-sidebar-brand"><span><Aperture size={20} /></span><div><strong>SNAPORE</strong><small>Super admin</small></div><button type="button" onClick={() => setSidebarOpen(false)} aria-label="Tutup menu"><X size={18} /></button></div>
        <nav className="super-sidebar-nav" aria-label="Super admin menu">
          <span className="super-nav-label">Management</span>
          {menuItems.map((item) => {
            const Icon = item.icon;
            return <button type="button" className={activeView === item.id && !(item.id === "payments" && selectedTenantId) ? "active" : ""} key={item.id} onClick={() => openView(item.id)}><Icon size={16} /><span>{item.label}</span>{item.id === "create-tenant" && <em>NEW</em>}</button>;
          })}
          <span className="super-nav-label tenant-label">Tenant workspace</span>
          <div className="super-tenant-menu">
            {data.tenants.map((tenant) => <button type="button" className={selectedTenantId === tenant.id ? "active" : ""} key={tenant.id} onClick={() => openTenantWorkspace(tenant.id)}><span>{tenant.name.slice(0, 1).toUpperCase()}</span><div><strong>{tenant.name}</strong><small>{tenant.counts.booths} booth · {tenant.counts.users} user</small></div><ChevronRight size={13} /></button>)}
            {!loading && data.tenants.length === 0 && <small>Belum ada tenant.</small>}
          </div>
        </nav>
        <div className="super-sidebar-profile"><div><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>Global access</small></div></div><form action="/api/auth/logout" method="post"><button type="submit" aria-label="Logout"><LogOut size={16} /></button></form></div>
      </aside>

      {sidebarOpen && <button className="super-sidebar-scrim" type="button" aria-label="Tutup menu" onClick={() => setSidebarOpen(false)} />}

      <main className="super-admin-page">
        <header className="super-admin-topbar">
          <button className="super-menu-toggle" type="button" onClick={() => setSidebarOpen(true)} aria-label="Buka menu"><Menu size={19} /></button>
          <div><span className="eyebrow"><ShieldCheck size={13} /> {copy.eyebrow}</span><h1>{selectedTenant && activeView === "payments" ? selectedTenant.name : copy.title}</h1><p>{selectedTenant && activeView === "payments" ? `Workspace pengaturan khusus tenant ${selectedTenant.name}.` : copy.description}</p></div>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Refresh</button>
        </header>

        {(message || error) && <div className={`frame-feedback super-feedback ${error ? "error" : "success"}`}>{error ?? message}</div>}

        {activeView === "overview" && <>
          <section className="super-metrics">
            <article><Store size={18} /><span>Tenants</span><strong>{data.tenants.length}</strong></article>
            <article><Monitor size={18} /><span>Booths</span><strong>{data.booths.length}</strong></article>
            <article><CircleDollarSign size={18} /><span>Gross sales</span><strong>{formatCurrency(totals.gross)}</strong></article>
            <article><ShieldCheck size={18} /><span>Net profit</span><strong>{formatCurrency(totals.net)}</strong><small>Pajak {formatCurrency(totals.tax)}</small></article>
          </section>
          <section className="super-quick-grid">
            <button type="button" onClick={() => openView("create-tenant")}><Plus size={20} /><div><strong>Tambah tenant</strong><span>Mulai workspace bisnis baru</span></div><ChevronRight size={16} /></button>
            <button type="button" onClick={() => openView("users")}><Users size={20} /><div><strong>Tambah user</strong><span>Atur akses tenant dan role</span></div><ChevronRight size={16} /></button>
            <button type="button" onClick={() => openView("booths")}><Monitor size={20} /><div><strong>Tambah booth</strong><span>Buat URL kiosk UUID baru</span></div><ChevronRight size={16} /></button>
          </section>
          <section className="super-section"><div className="section-heading"><div><h2>Tenant workspace</h2><p>Pilih tenant untuk membuka konfigurasi khusus.</p></div></div><div className="tenant-directory-grid">{data.tenants.map((tenant) => <button type="button" key={tenant.id} onClick={() => openTenantWorkspace(tenant.id)}><span>{tenant.status}</span><h3>{tenant.name}</h3><p>{tenant.counts.booths} booth · {tenant.counts.users} user · {tenant.counts.frames} frame</p><ChevronRight size={17} /></button>)}</div></section>
        </>}

        {activeView === "create-tenant" && <section className="super-single-form">
          <form className="super-form-card" onSubmit={submitSimple("createTenant")}>
            <div className="super-form-icon"><Building2 size={23} /></div><h2>Buat tenant baru</h2><p>Tenant memiliki user, booth, frame, pricing, pajak, serta konfigurasi payment yang terpisah.</p>
            <label>Nama tenant<input name="name" required minLength={2} placeholder="Studio Jakarta" /></label>
            <label>Slug unik<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="studio-jakarta" /></label>
            <div className="form-split"><label>Pajak %<input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue="11" /></label><label>Biaya/cetak<input name="defaultPrintCost" type="number" min="0" defaultValue="5000" /></label></div>
            <button className="primary-button" disabled={saving === "createTenant"}>{saving === "createTenant" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create tenant</button>
          </form>
        </section>}

        {activeView === "tenants" && <section className="super-section tenant-section-first">
          <div className="section-heading"><div><h2>{data.tenants.length} tenant aktif</h2><p>Setiap tenant memiliki menu pengaturan terpisah di sidebar.</p></div><button className="primary-button" type="button" onClick={() => openView("create-tenant")}><Plus size={14} /> Tambah tenant</button></div>
          <div className="tenant-directory-grid expanded">
            {data.tenants.map((tenant) => (
              <div className="tenant-card-wrapper" key={tenant.id} style={{ display: "flex", flexDirection: "column", background: "#1c1c1c", border: "1px solid #333", borderRadius: 16, overflow: "hidden" }}>
                <button type="button" style={{ display: "block", width: "100%", textAlign: "left", padding: 20, background: "none", border: "none", color: "inherit", cursor: "pointer" }} onClick={() => openTenantWorkspace(tenant.id)}>
                  <span className="database-badge" style={{ marginBottom: 10 }}>{tenant.status}</span>
                  <h3 style={{ fontSize: 20, margin: "6px 0 2px" }}>{tenant.name}</h3>
                  <code style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 12 }}>{tenant.slug}</code>
                  <p style={{ fontSize: 11, color: "#aaa" }}>{tenant.counts.booths} booth · {tenant.counts.users} user · {tenant.counts.frames} frame</p>
                </button>
                <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #2a2a2a", background: "#171717", justifyContent: "space-between", alignItems: "center" }}>
                  <button type="button" className="secondary-button" style={{ padding: "5px 12px", fontSize: 11 }} onClick={() => openTenantWorkspace(tenant.id)}>
                    Open workspace <ChevronRight size={13} />
                  </button>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      aria-label={`Edit ${tenant.name}`}
                      title="Edit tenant"
                      onClick={() => { setEditingTenant(tenant); setError(null); }}
                      style={{ padding: "6px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, background: "#2a2a2a", border: "1px solid #444", borderRadius: 8, color: "#eee", cursor: "pointer" }}
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus ${tenant.name}`}
                      title="Hapus tenant"
                      onClick={() => { setDeletingTenant(tenant); setError(null); }}
                      style={{ padding: "6px 10px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(224,62,45,0.12)", border: "1px solid rgba(224,62,45,0.35)", borderRadius: 8, color: "#e03e2d", cursor: "pointer" }}
                    >
                      <Trash2 size={12} /> Hapus
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>}

        {activeView === "users" && <div className="super-content-grid">
          <form className="super-form-card" onSubmit={submitSimple("createUser")}>
            <h2><Users size={18} /> Tambah user</h2>
            <label>Tenant<SearchableSelect name="tenantId" defaultValue="" ariaLabel="Tenant user" searchPlaceholder="Cari tenant..." options={[{ value: "", label: "Global / super admin" }, ...data.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]} /></label>
            <div className="form-split"><label>Nama<input name="name" required /></label><label>Role<SearchableSelect name="role" defaultValue="ADMIN" ariaLabel="Role user" options={["SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER"].map((role) => ({ value: role, label: role }))} /></label></div>
            <label>Email<input name="email" type="email" required /></label><label>Password awal<input name="password" type="password" minLength={10} required /></label>
            <button className="primary-button" disabled={saving === "createUser"}><Plus size={15} /> Create user</button>
          </form>
          <section className="super-directory-panel"><div className="section-heading"><div><h2>User directory</h2><p>{data.users.length} akun tersimpan</p></div></div><div className="user-directory">{data.users.map((user) => <article className={!user.active ? "inactive" : ""} key={user.id}><div><strong>{user.name}</strong><span>{user.email}</span><small>{user.tenantId ? data.tenants.find((tenant) => tenant.id === user.tenantId)?.name ?? "Tenant" : "Global account"}</small></div><em>{user.role}</em><button type="button" onClick={() => setEditingUser(user)} aria-label={`Edit ${user.name}`}><Pencil size={13} /> Edit</button></article>)}</div></section>
        </div>}

        {activeView === "booths" && <>
          <section className="super-booth-create"><form className="super-form-card" onSubmit={submitSimple("createBooth")}><h2><Monitor size={18} /> Tambah booth</h2><label>Tenant<SearchableSelect name="tenantId" required defaultValue="" placeholder="Pilih tenant" ariaLabel="Tenant booth" searchPlaceholder="Cari tenant..." options={data.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))} /></label><div className="form-split"><label>Kode<input name="code" required placeholder="JKT-001" /></label><label>Nama<input name="name" required /></label></div><label>Lokasi<input name="location" placeholder="Contoh: Lantai 1, dekat lobby" /></label><label>Zona waktu<SearchableSelect name="timezone" defaultValue="Asia/Jakarta" ariaLabel="Zona waktu booth" options={timezoneOptions} /></label><button className="primary-button" disabled={saving === "createBooth"}><Plus size={15} /> Create booth</button></form></section>
          <section className="super-section"><div className="section-heading"><div><h2>Booth & kiosk</h2><p>Identitas kiosk, resource, heartbeat, dan perangkat terhubung ditampilkan dalam satu kartu.</p></div></div><div className="booth-tenant-grid">{data.booths.map((booth) => {
            const operational = booth.kioskEnabled && !booth.maintenanceMode && booth.resourceReady;
            const displayedDevices = groupBoothDevices(booth.devices);
            const connectedDevices = displayedDevices.filter((device) => device.status === "ONLINE").length;
            return <article className={!operational ? "booth-card-inactive" : ""} key={booth.id}>
              <header className="booth-card-header"><div className="booth-card-status"><span className="status-chip"><span className={`status-dot ${operational ? "online" : booth.maintenanceMode ? "warn" : "error"}`} /> {operational ? "AKTIF" : booth.maintenanceMode ? "MAINTENANCE" : "NONAKTIF"}</span><small><Radio size={11} /> {booth.status}</small></div><button className="booth-edit-button" type="button" onClick={() => { setError(null); setEditingBooth(booth); }} aria-label={`Edit kiosk ${booth.name}`}><Pencil size={13} /> Edit</button></header>
              <div className="booth-card-title"><span>{booth.tenant}</span><h3>{booth.name}</h3><p><MapPin size={12} /> {booth.location || "Lokasi belum diisi"}</p></div>
              <div className="booth-meta-grid"><span><small>Kode kiosk</small><strong>{booth.code}</strong></span><span><small>Zona waktu</small><strong>{booth.timezone}</strong></span><span><small>Heartbeat</small><strong>{booth.lastHeartbeatAt ? formatDateTime(booth.lastHeartbeatAt) : "Belum ada"}</strong></span><span><small>Perangkat online</small><strong>{connectedDevices} / {displayedDevices.length} jenis</strong></span></div>
              {!operational && <div className="booth-readiness-warning">{booth.readinessReason ?? "Booth dinonaktifkan oleh admin."}</div>}
              <div className="booth-layout-counts"><span>Layout siap</span>{booth.layoutCounts.length ? booth.layoutCounts.map((count) => <b key={count}>{count}x</b>) : <em>Belum ada layout</em>}</div>
              <div className="booth-link-block"><small>URL kiosk</small><code title={booth.kioskUrl}>{booth.kioskUrl}</code></div>
              <div className="booth-card-actions"><button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${booth.kioskUrl}`)}><Copy size={13} /> Copy link</button><button className={`booth-voice-button ${booth.voiceEnabled ? "disable" : "enable"}`} type="button" disabled={saving === `voice-${booth.id}`} onClick={() => void send({ action: "updateBoothVoice", boothId: booth.id, enabled: !booth.voiceEnabled }, `voice-${booth.id}`)}>{saving === `voice-${booth.id}` ? <LoaderCircle className="spin" size={14} /> : booth.voiceEnabled ? <VolumeX size={14} /> : <Volume2 size={14} />} {booth.voiceEnabled ? "Suara off" : "Suara on"}</button><button className={`booth-power-button ${booth.kioskEnabled ? "disable" : "enable"}`} type="button" disabled={saving === `booth-${booth.id}`} onClick={() => void send({ action: "updateBoothStatus", boothId: booth.id, enabled: !booth.kioskEnabled }, `booth-${booth.id}`)}>{saving === `booth-${booth.id}` ? <LoaderCircle className="spin" size={14} /> : <Power size={14} />} {booth.kioskEnabled ? "Nonaktifkan" : "Aktifkan"}</button></div>
              <section className="booth-device-panel"><header><span>Perangkat terdaftar</span><b>{connectedDevices} online</b></header><div>{displayedDevices.map((device) => {
                const DeviceIcon = device.type === "CAMERA" ? Camera : device.type === "PRINTER" ? Printer : Monitor;
                return <div className="booth-device-row" key={`${device.type}:${device.name}`}><span className={`booth-device-icon ${device.status === "ONLINE" ? "online" : ""}`}><DeviceIcon size={14} /></span><div><strong>{device.name}</strong><small>{device.type}{device.preferred ? " · utama" : ""}{device.instances > 1 ? ` · ${device.instances} instance` : ""}{device.driverName ? ` · ${device.driverName}` : ""}</small></div><em className={device.status === "ONLINE" ? "online" : ""}>{device.status}</em></div>;
              })}{displayedDevices.length === 0 && <p className="booth-device-empty">Belum ada perangkat yang dilaporkan kiosk.</p>}</div></section>
            </article>;
          })}</div></section>
        </>}

        {activeView === "sessions" && <section className="super-section tenant-section-first">
          <div className="section-heading">
            <div><h2>Daftar sessions</h2><p>{visibleSessions.length} dari {data.sessions.length} sesi · {productionSessionCount} production · {testingSessionCount} testing.</p></div>
          </div>
          <div className="session-filter-panel">
            <label>Tenant<SearchableSelect value={sessionTenantId} onValueChange={(value) => { setSessionTenantId(value); setSessionBoothId(""); }} ariaLabel="Filter tenant sesi" searchPlaceholder="Cari tenant..." options={[{ value: "", label: "Semua tenant" }, ...data.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]} /></label>
            <label>Kiosk<SearchableSelect value={sessionBoothId} onValueChange={setSessionBoothId} ariaLabel="Filter kiosk sesi" searchPlaceholder="Cari kiosk..." options={[{ value: "", label: "Semua kiosk" }, ...sessionBoothOptions.map((booth) => ({ value: booth.id, label: `${booth.name} · ${booth.code}` }))]} /></label>
            <div className="session-kind-filter" role="group" aria-label="Filter tipe sesi"><span>Tipe sesi</span><div>{(["ALL", "PRODUCTION", "TESTING"] as SessionKindFilter[]).map((kind) => <button className={sessionKindFilter === kind ? "active" : ""} type="button" key={kind} onClick={() => setSessionKindFilter(kind)}>{kind === "ALL" ? `Semua ${data.sessions.length}` : kind === "PRODUCTION" ? `Production ${productionSessionCount}` : `Testing ${testingSessionCount}`}</button>)}</div></div>
          </div>
          {dateRangeFilter}
          <div className="session-recovery-list">
            {visibleSessions.map((session) => <article className={`session-recovery-card ${session.sessionKind === "TESTING" ? "testing" : ""}`} key={session.id}>
              <header>
                <div><span>{session.tenant} · {session.boothCode}</span><h3>{session.publicCode}</h3><p>{session.booth} · {formatDateTime(session.startedAt)}</p></div>
                <div className="session-card-badges"><span className={`session-kind-chip ${session.sessionKind.toLowerCase()}`}>{session.sessionKind === "TESTING" ? <FlaskConical size={12} /> : <ShieldCheck size={12} />}{session.sessionKind}</span><span className="status-chip"><span className={`status-dot ${session.status === "COMPLETED" ? "online" : ["CANCELLED", "EXPIRED", "FAILED"].includes(session.status) ? "error" : "warn"}`} /> {session.status}</span></div>
              </header>
              {session.sessionKind === "TESTING" && <div className="session-testing-note"><FlaskConical size={14} /><div><strong>Tidak masuk laporan sales</strong><span>{session.testingReason ?? "Sesi testing / bypass pembayaran"}</span></div></div>}
              <div className="session-recovery-facts">
                <span><small>Layout / frame</small><strong>{session.layout ?? "Belum dipilih"}{session.frame ? ` · ${session.frame}` : ""}</strong></span>
                <span><small>Foto</small><strong>{session.photoCount}</strong></span>
                <span><small>Payment</small><strong>{session.paymentStatus}</strong></span>
                <span><small>Upload</small><strong>{session.uploadStatus ?? "Belum ada job"}</strong></span>
                <span><small>{session.sessionKind === "TESTING" ? "Nilai simulasi" : "Total"}</small><strong>{formatCurrency(session.total)}</strong></span>
              </div>
              <details className="session-photo-detail compact">
                <summary><Images size={14} /> Detail foto · {session.assets.filter((asset) => asset.kind === "ORIGINAL").length} raw</summary>
                <div className="session-photo-grid">
                  {session.assets.map((asset, index) => <article key={asset.id}><img src={`/api/session-assets/${asset.id}`} alt={asset.kind === "ORIGINAL" ? `Foto raw ${index + 1}` : `Hasil frame ${session.publicCode}`} /><span>{asset.kind === "ORIGINAL" ? `RAW ${(asset.slotIndex ?? index) + 1}` : "HASIL FRAME"}</span><a href={`/api/session-assets/${asset.id}?download=1`}><Download size={12} /> Unduh</a></article>)}
                  {session.assets.length === 0 ? <p>Foto belum tersinkronisasi.</p> : null}
                </div>
              </details>
              <footer>
                {session.activeReset ? <div className="active-reset-code"><span>Kode aktif sampai {formatDateTime(session.activeReset.expiresAt)}</span>{session.activeReset.code ? <strong>{session.activeReset.code}</strong> : <em>Kode aktif</em>}{session.activeReset.code ? <button type="button" onClick={() => void navigator.clipboard.writeText(session.activeReset?.code ?? "")} aria-label={`Salin kode reset ${session.publicCode}`}><Copy size={13} /></button> : null}</div> : <p>{session.resettable ? "Buat kode jika pengguna perlu mengulang foto tanpa membayar kembali." : "Reset tidak tersedia setelah sesi selesai atau job cetak dibuat."}</p>}
                <div className="session-card-actions"><SessionGalleryPreview sessionId={session.id} publicCode={session.publicCode} available={session.galleryAvailable} /><button className="secondary-button" type="button" disabled={!session.resettable || saving === `reset-${session.id}`} onClick={() => void generateResetCode(session.id)}>{saving === `reset-${session.id}` ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />} {session.activeReset ? "Generate ulang" : "Generate kode 6 digit"}</button></div>
              </footer>
            </article>)}
            {!loading && visibleSessions.length === 0 ? <div className="tenant-workspace-empty"><Images size={25} /><strong>Belum ada sesi</strong><span>Tidak ada sesi yang cocok dengan tenant, kiosk, tipe, dan rentang waktu terpilih.</span></div> : null}
          </div>
        </section>}

        {activeView === "payments" && <section className="super-section tenant-section-first">
          <div className="section-heading"><div><h2>Tenant settings & Xendit QRIS</h2><p>Secret ditampilkan tersamarkan dan disimpan terenkripsi.</p></div><label className="tenant-filter">Tenant<SearchableSelect value={selectedTenantId ?? ""} onValueChange={(value) => setSelectedTenantId(value || null)} ariaLabel="Filter tenant pembayaran" searchPlaceholder="Cari tenant..." options={[{ value: "", label: "Semua tenant" }, ...data.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]} /></label></div>
          <div className="tenant-setting-grid">
            {visibleTenants.map((tenant) => <form className="tenant-setting-card" key={tenant.id} onSubmit={async (event) => {
              event.preventDefault();
              const values = formObject(event.currentTarget);
              await send({ action: "updateTenant", tenantId: tenant.id, taxRate: values.taxRate, pricesIncludeTax: values.pricesIncludeTax === "on", defaultPrintCost: values.defaultPrintCost, paymentFeeRate: values.paymentFeeRate, paymentFeeFixed: values.paymentFeeFixed, xenditEnabled: values.xenditEnabled === "on", xenditEnvironment: values.xenditEnvironment, xenditApiKey: values.xenditApiKey || undefined, xenditWebhookToken: values.xenditWebhookToken || undefined }, `tenant-${tenant.id}`);
            }}>
              <header><div><span>{tenant.slug}</span><h3>{tenant.name}</h3></div><em>{tenant.counts.booths} booth · {tenant.counts.frames} frame</em></header>
              <div className="tenant-finance-fields"><label>Pajak %<input name="taxRate" type="number" step="0.01" defaultValue={tenant.taxRate} /></label><label>Biaya per cetak<input name="defaultPrintCost" type="number" defaultValue={tenant.defaultPrintCost} /></label><label>Fee Xendit %<input name="paymentFeeRate" type="number" step="0.01" defaultValue={tenant.paymentFeeRate} /></label><label>Fee tetap<input name="paymentFeeFixed" type="number" defaultValue={tenant.paymentFeeFixed} /></label></div>
              <div className="tenant-checks"><label><input name="pricesIncludeTax" type="checkbox" defaultChecked={tenant.pricesIncludeTax} /> Harga termasuk pajak</label><label><input name="xenditEnabled" type="checkbox" defaultChecked={tenant.payment.enabled} /> Aktifkan Xendit QRIS</label></div>
              <label>Environment<SearchableSelect name="xenditEnvironment" defaultValue={tenant.payment.environment} ariaLabel="Environment Xendit" options={[{ value: "TEST", label: "Test" }, { value: "LIVE", label: "Live" }]} /></label>
              <div className="secret-input"><span><KeyRound size={13} /> API key: {tenant.payment.apiKeyMasked ?? "belum diisi"}</span><input name="xenditApiKey" type="password" placeholder="Isi hanya untuk mengganti key" autoComplete="new-password" /></div>
              <div className="secret-input"><span>Webhook token: {tenant.payment.webhookTokenMasked ?? "belum diisi"}</span><input name="xenditWebhookToken" type="password" placeholder="Isi hanya untuk mengganti token" autoComplete="new-password" /></div>
              <code className="webhook-url">Webhook: /api/payments/xendit/webhook</code><button className="primary-button" disabled={saving === `tenant-${tenant.id}`}><Settings2 size={15} /> Save settings</button>
            </form>)}
          </div>
          <div className="tenant-frame-workspace">
            <div className="section-heading"><div><h2><ImagePlus size={18} /> Frame tenant</h2><p>{selectedTenant ? `Upload hanya masuk ke ${selectedTenant.name} dan booth yang dipilih.` : "Pilih satu tenant untuk mengelola frame miliknya."}</p></div></div>
            {selectedTenant
              ? selectedTenantBooths.length > 0
                ? <FrameManager key={selectedTenant.id} booths={selectedTenantBooths} />
                : <div className="tenant-workspace-empty"><Monitor size={25} /><strong>Tenant belum memiliki booth</strong><span>Buat booth terlebih dahulu sebelum mengunggah frame.</span><button className="primary-button" type="button" onClick={() => openView("booths")}><Plus size={14} /> Tambah booth</button></div>
              : <div className="tenant-workspace-empty"><Building2 size={25} /><strong>Pilih tenant</strong><span>Gunakan pilihan tenant di atas atau menu workspace pada sidebar.</span></div>}
          </div>
        </section>}

        {activeView === "sales" && <>
          <section className="super-section tenant-section-first">
            <div className="section-heading">
              <div><h2>Sales by booth & device</h2><p>Gross − pajak − biaya cetak − fee pembayaran = laba bersih</p></div>
              <a className="primary-button sales-export-button" href={`/api/super-admin/sales-export${appliedDateQuery ? `?${appliedDateQuery}` : ""}`}><Download size={15} /> Download Excel</a>
            </div>
            {dateRangeFilter}
            <div className="sales-exclusion-note"><FlaskConical size={16} /><div><strong>Data testing tidak dihitung sebagai penjualan</strong><span>{data.salesSummary.excludedTestingOrders} order bypass/Xendit TEST dikeluarkan dari gross sales, biaya, pajak, dan net profit pada rentang ini.</span></div></div>
            <div className="sales-kpi-grid">
              <article><CircleDollarSign size={18} /><span>Gross sales</span><strong>{formatCurrency(totals.gross)}</strong></article>
              <article><ShieldCheck size={18} /><span>Net profit</span><strong>{formatCurrency(totals.net)}</strong></article>
              <article className="success"><CheckCircle2 size={18} /><span>Foto berhasil</span><strong>{successfulPhotoCount}</strong></article>
              <article className="failed"><XCircle size={18} /><span>Foto gagal</span><strong>{failedPhotoCount}</strong></article>
            </div>
            <div className="table-wrap"><table className="data-table"><thead><tr><th>Tenant / Booth</th><th>Device</th><th>Order</th><th>Gross</th><th>Pajak</th><th>Cost + fee</th><th>Net profit</th></tr></thead><tbody>{data.sales.map((row, index) => <tr key={`${row.booth}-${row.device}-${index}`}><td><strong>{row.booth}</strong><small>{row.tenant} · {row.prints} cetak</small></td><td>{row.device}</td><td>{row.orders}</td><td>{formatCurrency(row.gross)}</td><td>{formatCurrency(row.tax)}</td><td>{formatCurrency(row.printCost + row.paymentFee)}</td><td><strong>{formatCurrency(row.netProfit)}</strong></td></tr>)}{data.sales.length === 0 && <tr><td colSpan={7}>Belum ada penjualan yang tercatat.</td></tr>}</tbody></table></div>
          </section>

          <section className="super-section sales-photo-results">
            <div className="section-heading">
              <div><h2>Detail foto berhasil & gagal</h2><p>Pilih sesi bermasalah untuk membuat kode retake 6 digit tanpa pembayaran ulang.</p></div>
              <div className="photo-result-filters" role="group" aria-label="Filter hasil foto">
                {(["ALL", "SUCCESS", "FAILED"] as PhotoResultFilter[]).map((filter) => <button type="button" className={photoResultFilter === filter ? "active" : ""} key={filter} onClick={() => setPhotoResultFilter(filter)}>{filter === "ALL" ? `Semua ${completedPhotoSessions.length}` : filter === "SUCCESS" ? `Berhasil ${successfulPhotoCount}` : `Gagal ${failedPhotoCount}`}</button>)}
              </div>
            </div>
            <div className="photo-result-list">
              {salesPhotoSessions.map((session) => {
                const outcome = photoSessionOutcome(session.status);
                return <article className={`photo-result-card ${outcome.toLowerCase()}`} key={session.id}>
                  <header><div><span>{session.tenant} · {session.boothCode}</span><h3>{session.publicCode}</h3><p>{formatDateTime(session.startedAt)} · {session.layout ?? "Layout belum dipilih"}</p></div><strong>{outcome === "SUCCESS" ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {outcome === "SUCCESS" ? "BERHASIL" : "GAGAL"}</strong></header>
                  <div className="photo-result-facts"><span><small>Status</small><b>{session.status}</b></span><span><small>Foto</small><b>{session.photoCount}</b></span><span><small>Frame</small><b>{session.frame ?? "—"}</b></span><span><small>Payment</small><b>{session.paymentStatus}</b></span><span><small>Total</small><b>{formatCurrency(session.total)}</b></span></div>
                  <footer>
                    {session.activeReset ? <div className="active-reset-code"><span>Berlaku sampai {formatDateTime(session.activeReset.expiresAt)}</span>{session.activeReset.code ? <strong>{session.activeReset.code}</strong> : <em>Kode aktif</em>}{session.activeReset.code ? <button type="button" onClick={() => void navigator.clipboard.writeText(session.activeReset?.code ?? "")} aria-label={`Salin kode reset ${session.publicCode}`}><Copy size={13} /></button> : null}</div> : <p>{session.resettable ? "Sesi dapat diulang dengan kode retake." : "Kode retake tidak tersedia untuk status pembayaran/job sesi ini."}</p>}
                    <button className="secondary-button" type="button" disabled={!session.resettable || saving === `reset-${session.id}`} onClick={() => void generateResetCode(session.id)}>{saving === `reset-${session.id}` ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />} {session.activeReset ? "Generate ulang" : "Generate kode retake"}</button>
                  </footer>
                </article>;
              })}
              {!loading && salesPhotoSessions.length === 0 ? <div className="tenant-workspace-empty"><Images size={25} /><strong>Tidak ada hasil</strong><span>Belum ada sesi foto pada filter ini.</span></div> : null}
            </div>
          </section>
        </>}
      </main>

      {editingUser && <div className="user-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingUser(null); }}>
        <section className="user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
          <header><div><span className="eyebrow"><Pencil size={13} /> User access</span><h2 id="edit-user-title">Edit user</h2><p>Perbarui identitas, tenant, role, status akun, atau password.</p></div><button type="button" onClick={() => setEditingUser(null)} disabled={Boolean(saving)} aria-label="Tutup edit user"><X size={18} /></button></header>
          <form onSubmit={async (event) => {
            event.preventDefault();
            const values = formObject(event.currentTarget);
            const ok = await send({ action: "updateUser", userId: editingUser.id, tenantId: values.tenantId || null, name: values.name, email: values.email, role: values.role, active: values.active === "on", password: values.password || undefined }, `user-${editingUser.id}`);
            if (ok) setEditingUser(null);
          }}>
            <div className="form-split"><label>Nama<input name="name" required defaultValue={editingUser.name} /></label><label>Email<input name="email" type="email" required defaultValue={editingUser.email} /></label></div>
            <div className="form-split"><label>Role<SearchableSelect name="role" defaultValue={editingUser.role} ariaLabel="Edit role user" options={["SUPER_ADMIN", "ADMIN", "OPERATOR", "VIEWER"].map((role) => ({ value: role, label: role }))} /></label><label>Tenant<SearchableSelect name="tenantId" defaultValue={editingUser.tenantId ?? ""} ariaLabel="Edit tenant user" searchPlaceholder="Cari tenant..." options={[{ value: "", label: "Global / tanpa tenant" }, ...data.tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]} /></label></div>
            <label>Password baru <small>Opsional, minimal 10 karakter</small><input name="password" type="password" minLength={10} autoComplete="new-password" placeholder="Kosongkan jika tidak diubah" /></label>
            <label className="user-active-check"><input name="active" type="checkbox" defaultChecked={editingUser.active} /> Akun aktif dan dapat login</label>
            <footer><button className="secondary-button" type="button" onClick={() => setEditingUser(null)} disabled={Boolean(saving)}>Cancel</button><button className="primary-button" disabled={saving === `user-${editingUser.id}`}>{saving === `user-${editingUser.id}` ? <LoaderCircle className="spin" size={15} /> : <Settings2 size={15} />} Save user</button></footer>
          </form>
        </section>
      </div>}

      {editingBooth && (
        <div className="frame-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingBooth(null); }}>
          <section className="frame-modal" style={{ width: "min(560px, 100%)" }} role="dialog" aria-modal="true" aria-labelledby="edit-booth-title">
            <header>
              <div><span className="eyebrow"><Monitor size={13} /> Edit kiosk</span><h2 id="edit-booth-title">{editingBooth.name}</h2><p>Perbarui identitas operasional kiosk. Tenant dan UUID tetap dipertahankan agar histori sesi tidak berubah.</p></div>
              <button type="button" className="frame-modal-close" onClick={() => setEditingBooth(null)} disabled={Boolean(saving)} aria-label="Tutup edit kiosk"><X size={19} /></button>
            </header>
            <form onSubmit={async (event) => {
              event.preventDefault();
              const values = formObject(event.currentTarget);
              const label = `booth-details-${editingBooth.id}`;
              const ok = await send({ action: "updateBoothDetails", boothId: editingBooth.id, code: values.code, name: values.name, location: values.location, timezone: values.timezone }, label);
              if (ok) setEditingBooth(null);
            }}>
              <div className="frame-form-copy booth-edit-form">
                <div className="form-split"><label><span>Nama kiosk</span><input name="name" defaultValue={editingBooth.name} minLength={2} maxLength={80} required /></label><label><span>Kode unik</span><input name="code" defaultValue={editingBooth.code} pattern="[A-Za-z0-9-]+" minLength={2} maxLength={30} required /></label></div>
                <label><span>Lokasi</span><input name="location" defaultValue={editingBooth.location ?? ""} maxLength={120} placeholder="Contoh: Lantai 1, dekat lobby" /></label>
                <label><span>Zona waktu</span><SearchableSelect name="timezone" defaultValue={editingBooth.timezone} ariaLabel="Edit zona waktu kiosk" options={timezoneOptions.some((item) => item.value === editingBooth.timezone) ? timezoneOptions : [{ value: editingBooth.timezone, label: editingBooth.timezone }, ...timezoneOptions]} /></label>
                <div className="booth-edit-identity"><span><small>Tenant</small><strong>{editingBooth.tenant}</strong></span><span><small>UUID kiosk</small><code>{editingBooth.id}</code></span></div>
              </div>
              {error && <div className="frame-feedback error" style={{ margin: "0 24px 16px" }} role="alert">{error}</div>}
              <footer><button className="secondary-button" type="button" onClick={() => setEditingBooth(null)} disabled={Boolean(saving)}>Batal</button><button className="primary-button" type="submit" disabled={saving === `booth-details-${editingBooth.id}`}>{saving === `booth-details-${editingBooth.id}` ? <LoaderCircle className="spin" size={16} /> : <Pencil size={16} />} Simpan kiosk</button></footer>
            </form>
          </section>
        </div>
      )}

      {editingTenant && (
        <div className="frame-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setEditingTenant(null); }}>
          <section className="frame-modal" style={{ width: "min(520px, 100%)" }} role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow"><Pencil size={13} /> Edit Tenant</span>
                <h2>Edit {editingTenant.name}</h2>
                <p>Ubah nama tenant, slug, status operasional, pajak, dan biaya cetak.</p>
              </div>
              <button type="button" className="frame-modal-close" onClick={() => setEditingTenant(null)} disabled={Boolean(saving)} aria-label="Tutup"><X size={19} /></button>
            </header>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const values = formObject(e.currentTarget);
              const ok = await send({ action: "updateTenantDetails", tenantId: editingTenant.id, ...values }, "updateTenantDetails");
              if (ok) setEditingTenant(null);
            }}>
              <div className="frame-form-copy" style={{ display: "flex", flexDirection: "column", gap: 12, padding: 24 }}>
                <label><span>Nama tenant</span><input name="name" defaultValue={editingTenant.name} minLength={2} maxLength={80} required /></label>
                <label><span>Slug unik</span><input name="slug" defaultValue={editingTenant.slug} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
                <label><span>Status</span><SearchableSelect name="status" defaultValue={editingTenant.status} ariaLabel="Status tenant" options={[{ value: "ACTIVE", label: "ACTIVE" }, { value: "SUSPENDED", label: "SUSPENDED" }]} /></label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label><span>Pajak %</span><input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue={editingTenant.taxRate} required /></label>
                  <label><span>Biaya cetak</span><input name="defaultPrintCost" type="number" min="0" defaultValue={editingTenant.defaultPrintCost} required /></label>
                </div>
              </div>
              {error && <div className="frame-feedback error" style={{ margin: "0 24px 16px" }} role="alert">{error}</div>}
              <footer>
                <button className="secondary-button" type="button" onClick={() => setEditingTenant(null)} disabled={Boolean(saving)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={saving === "updateTenantDetails"}>
                  {saving === "updateTenantDetails" ? <LoaderCircle className="spin" size={16} /> : <Pencil size={16} />} Update tenant
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {deletingTenant && (
        <div className="frame-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setDeletingTenant(null); }}>
          <section className="frame-modal" style={{ width: "min(480px, 100%)" }} role="dialog" aria-modal="true">
            <header>
              <div>
                <span className="eyebrow" style={{ color: "#e03e2d" }}><Trash2 size={13} /> Delete Tenant</span>
                <h2>Hapus Tenant</h2>
                <p>Apakah Anda yakin ingin menghapus tenant <strong>{deletingTenant.name}</strong> ({deletingTenant.slug})?</p>
              </div>
              <button type="button" className="frame-modal-close" onClick={() => setDeletingTenant(null)} disabled={Boolean(saving)} aria-label="Tutup"><X size={19} /></button>
            </header>
            <footer style={{ padding: "20px 24px" }}>
              <p style={{ color: "#e03e2d", fontSize: "11px", marginBottom: 16 }}>⚠️ PERINGATAN: Seluruh booth, user, frame, dan data yang terhubung dengan tenant ini akan terhapus.</p>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="secondary-button" type="button" onClick={() => setDeletingTenant(null)} disabled={Boolean(saving)}>Batal</button>
                <button className="primary-button" style={{ background: "#e03e2d", borderColor: "#c02e1d", color: "white" }} type="button" onClick={async () => {
                  const ok = await send({ action: "deleteTenant", tenantId: deletingTenant.id }, "deleteTenant");
                  if (ok) setDeletingTenant(null);
                }} disabled={saving === "deleteTenant"}>
                  {saving === "deleteTenant" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                  {saving === "deleteTenant" ? "Hapus..." : "Hapus Tenant"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
