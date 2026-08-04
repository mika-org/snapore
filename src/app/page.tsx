import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  Camera,
  ChevronRight,
  CircleDollarSign,
  CloudUpload,
  Monitor,
  Printer,
  ScanLine,
  Tablet,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function currency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function dateTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}

function heartbeatLabel(value: Date | null, timeZone: string) {
  return value ? `Heartbeat ${dateTime(value, timeZone)}` : null;
}

function statusClass(status: string) {
  if (["ONLINE", "PRINTED", "SYNCED", "COMPLETED", "PAID"].includes(status)) return "online";
  if (["DEGRADED", "PAIRING", "UPLOADING", "RETRYING", "QUEUED", "PRINTING", "SPOOLING"].includes(status)) return "warn";
  return "error";
}

function deviceIcon(type: string) {
  if (type === "CAMERA") return Camera;
  if (type === "PRINTER") return Printer;
  if (type === "TABLET") return Tablet;
  return Monitor;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!user.tenantId) redirect("/login");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tenantId = user.tenantId;
  const sessionScope = { booth: { tenantId } };
  const [tenant, sessionsToday, printJobsToday, pendingUploads, recentSessions, recentPrintJobs, recentUploadJobs] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        booths: {
          orderBy: { createdAt: "asc" },
          include: {
            devices: {
              orderBy: [{ preferred: "desc" }, { createdAt: "asc" }],
              include: { cameraProfile: true, printerProfile: true, paperCounter: true },
            },
          },
        },
      },
    }),
    prisma.photoSession.findMany({
      where: { ...sessionScope, startedAt: { gte: todayStart } },
      select: { id: true, order: { select: { total: true } } },
    }),
    prisma.printJob.findMany({
      where: { queuedAt: { gte: todayStart }, order: { session: sessionScope } },
      select: { status: true },
    }),
    prisma.uploadJob.count({
      where: { status: { in: ["QUEUED", "UPLOADING", "RETRYING"] }, session: sessionScope },
    }),
    prisma.photoSession.findMany({
      where: sessionScope,
      orderBy: { startedAt: "desc" },
      take: 6,
      include: {
        booth: { select: { code: true, timezone: true } },
        layoutVersion: { include: { layout: { select: { name: true } } } },
        order: { include: { payment: true, printJobs: true } },
        uploadJobs: { orderBy: { updatedAt: "desc" }, take: 1 },
      },
    }),
    prisma.printJob.findMany({
      where: { order: { session: sessionScope } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { device: { select: { name: true } }, order: { include: { session: { select: { publicCode: true } } } } },
    }),
    prisma.uploadJob.findMany({
      where: { session: sessionScope },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { session: { select: { publicCode: true } } },
    }),
  ]);

  const booth = tenant?.booths[0] ?? null;
  const timeZone = booth?.timezone ?? "Asia/Bangkok";
  const kioskUrl = booth?.kioskEnabled ? `/kiosk/${booth.id}` : null;
  const revenueToday = sessionsToday.reduce((total, session) => total + Number(session.order?.total ?? 0), 0);
  const printedToday = printJobsToday.filter((job) => job.status === "PRINTED").length;
  const printSuccess = printJobsToday.length ? Math.round((printedToday / printJobsToday.length) * 1000) / 10 : 0;
  const jobs = [
    ...recentPrintJobs.map((job) => ({
      id: `print-${job.id}`,
      at: job.updatedAt,
      title: `${job.order.session.publicCode} · Print`,
      detail: `${job.copies} copy${job.copies === 1 ? "" : "ies"}${job.device ? ` · ${job.device.name}` : " · printer belum ditetapkan"}`,
      status: job.status,
    })),
    ...recentUploadJobs.map((job) => ({
      id: `upload-${job.id}`,
      at: job.updatedAt,
      title: `${job.session.publicCode} · Upload`,
      detail: `${job.attemptCount} percobaan${job.lastError ? ` · ${job.lastError}` : ""}`,
      status: job.status,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 6);

  return (
    <AppShell workspace={{
      name: tenant?.name ?? "Tenant",
      code: booth?.code ?? null,
      userName: user.name,
      userRole: user.role,
      kioskUrl,
      boothStatus: booth?.status ?? null,
      lastHeartbeatLabel: heartbeatLabel(booth?.lastHeartbeatAt ?? null, timeZone),
    }}>
      <header className="page-header">
        <div>
          <div className="eyebrow"><Zap size={13} fill="currentColor" /> {new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone }).format(new Date())}</div>
          <h1>{booth ? `${booth.name} ${booth.status.toLowerCase()}.` : "Belum ada booth."}<br />Data operasional aktual.</h1>
          <p>Ringkasan ini dihitung langsung dari sesi, pembayaran, print job, upload job, dan heartbeat perangkat milik tenant.</p>
        </div>
        <div className="header-actions">
          {kioskUrl ? <Link className="primary-button" href={kioskUrl}>Launch kiosk <ArrowUpRight size={15} /></Link> : null}
        </div>
      </header>

      <section className="metric-grid" aria-label="Ringkasan hari ini">
        <article className="metric-card featured">
          <div className="metric-label">Revenue today <span className="metric-icon"><CircleDollarSign size={15} /></span></div>
          <div className="metric-value">{currency(revenueToday)}</div>
          <div className="metric-foot">Dari {sessionsToday.filter((session) => session.order).length} order hari ini</div>
          <div className="metric-stamp">DB</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Sessions <span className="metric-icon"><Users size={15} /></span></div>
          <div className="metric-value">{sessionsToday.length}</div>
          <div className="metric-foot">Sesi dimulai sejak pukul 00.00</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Print success <span className="metric-icon"><Printer size={15} /></span></div>
          <div className="metric-value">{printSuccess}%</div>
          <div className="metric-foot">{printedToday} dari {printJobsToday.length} job tercetak</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">Sync queue <span className="metric-icon"><CloudUpload size={15} /></span></div>
          <div className="metric-value">{pendingUploads}</div>
          <div className="metric-foot">Job queued, uploading, atau retrying</div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header">
            <div><h2>Live booth operations</h2><p>Data heartbeat dan perangkat dari PostgreSQL</p></div>
            {booth ? <span className="live-badge"><span className={`status-dot ${statusClass(booth.status)}`} /> {booth.status}</span> : null}
          </div>
          <div className="panel-body">
            {booth ? (
              <>
                <div className="booth-hero">
                  <div>
                    <div className="booth-name"><span><ScanLine size={18} /></span> {booth.name}</div>
                    <div className="booth-meta">{booth.code}{booth.location ? ` · ${booth.location}` : ""} · {heartbeatLabel(booth.lastHeartbeatAt, timeZone) ?? "belum ada heartbeat"}</div>
                  </div>
                </div>
                <div className="device-grid">
                  {booth.devices.map((device) => {
                    const Icon = deviceIcon(device.type);
                    const paper = device.paperCounter;
                    const paperPercent = paper?.capacity ? Math.min(100, Math.round((paper.currentSheets / paper.capacity) * 100)) : null;
                    const profile = device.cameraProfile
                      ? `${device.cameraProfile.kind} · ${device.cameraProfile.width}×${device.cameraProfile.height}`
                      : device.printerProfile
                        ? `${device.printerProfile.kind} · ${device.printerProfile.mediaName} · ${device.printerProfile.dpi} DPI`
                        : device.type;
                    return (
                      <article className="device-card" key={device.id}>
                        <div className="device-card-top"><span><Icon size={16} /></span><span className="status-chip"><span className={`status-dot ${statusClass(device.status)}`} /> {device.status}</span></div>
                        <h3>{device.name}{device.preferred ? " · preferred" : ""}</h3><p>{profile}</p>
                        {paperPercent !== null ? <><div className="paper-meter"><span style={{ width: `${paperPercent}%` }} /></div><div className="paper-caption"><span>{paper?.currentSheets} sheets</span><span>{paperPercent}%</span></div></> : null}
                      </article>
                    );
                  })}
                  {booth.devices.length === 0 ? <div className="inline-empty">Belum ada perangkat yang terdaftar untuk booth ini.</div> : null}
                </div>
              </>
            ) : <div className="inline-empty">Tenant belum memiliki booth. Super Admin perlu membuat booth terlebih dahulu.</div>}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div><h2>Job pulse</h2><p>Print dan upload terbaru</p></div>
            <ChevronRight size={17} />
          </div>
          <div className="panel-body queue-list">
            {jobs.map((job, index) => (
              <div className="queue-item" key={job.id}>
                <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{job.title}</strong><span>{job.detail} · {dateTime(job.at, timeZone)}</span></div>
                <span className={`queue-status ${statusClass(job.status) === "online" ? "printed" : statusClass(job.status) === "warn" ? "waiting" : "failed"}`}>{job.status}</span>
              </div>
            ))}
            {jobs.length === 0 ? <div className="inline-empty">Belum ada print job atau upload job.</div> : null}
            <Link className="secondary-button" href="/sessions" style={{ marginTop: 10 }}>View every session <ArrowUpRight size={14} /></Link>
          </div>
        </article>
      </section>

      <section className="panel activity-panel">
        <div className="panel-header"><div><h2>Recent sessions</h2><p>Jejak sesi, pembayaran, dan hasil cetak terbaru</p></div><Link href="/sessions" className="secondary-button">See all</Link></div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Session</th><th>Time</th><th>Layout</th><th>Copies</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {recentSessions.map((session) => (
                <tr key={session.id}>
                  <td className="session-code">{session.publicCode}</td>
                  <td>{dateTime(session.startedAt, session.booth.timezone)}</td>
                  <td>{session.layoutVersion?.layout.name ?? "Belum dipilih"}</td>
                  <td>{session.order?.copies ?? 0}</td>
                  <td><strong>{currency(Number(session.order?.total ?? 0))}</strong></td>
                  <td><span className="status-chip"><span className={`status-dot ${statusClass(session.status)}`} />{session.status}</span></td>
                </tr>
              ))}
              {recentSessions.length === 0 ? <tr><td colSpan={6}><div className="table-empty">Belum ada sesi untuk tenant ini.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
