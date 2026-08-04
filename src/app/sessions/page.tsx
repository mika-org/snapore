import Link from "next/link";
import { Images, Search } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function dateTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}

function heartbeatLabel(value: Date | null, timeZone: string) {
  return value ? `Heartbeat ${dateTime(value, timeZone)}` : null;
}

function statusClass(status: string) {
  if (["SYNCED", "COMPLETED", "PAID", "PRINTED"].includes(status)) return "online";
  if (["QUEUED", "UPLOADING", "RETRYING", "CAPTURING", "REVIEWING", "CHECKOUT"].includes(status)) return "warn";
  return status === "CREATED" || status === "LAYOUT_SELECTED" || status === "COMPOSED" ? "" : "error";
}

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!user.tenantId) redirect("/login");

  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";
  const tenantId = user.tenantId;
  const sessionWhere = {
    booth: { tenantId },
    ...(query ? {
      OR: [
        { publicCode: { contains: query, mode: "insensitive" as const } },
        { booth: { code: { contains: query, mode: "insensitive" as const } } },
        { booth: { name: { contains: query, mode: "insensitive" as const } } },
      ],
    } : {}),
  };

  const [tenant, sessions, totalSessions] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, include: { booths: { orderBy: { createdAt: "asc" }, take: 1 } } }),
    prisma.photoSession.findMany({
      where: sessionWhere,
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        booth: { select: { code: true, name: true, timezone: true } },
        layoutVersion: { include: { layout: { select: { name: true } } } },
        order: { include: { payment: true, printJobs: { orderBy: { updatedAt: "desc" } } } },
        uploadJobs: { orderBy: { updatedAt: "desc" } },
      },
    }),
    prisma.photoSession.count({ where: { booth: { tenantId } } }),
  ]);
  const booth = tenant?.booths[0] ?? null;
  const timeZone = booth?.timezone ?? "Asia/Bangkok";
  const printedCopies = sessions.reduce((sum, session) => sum + (session.order?.printJobs.filter((job) => job.status === "PRINTED").reduce((copies, job) => copies + job.copies, 0) ?? 0), 0);

  return (
    <AppShell workspace={{
      name: tenant?.name ?? "Tenant",
      code: booth?.code ?? null,
      userName: user.name,
      userRole: user.role,
      kioskUrl: booth?.kioskEnabled ? `/kiosk/${booth.id}` : null,
      boothStatus: booth?.status ?? null,
      lastHeartbeatLabel: heartbeatLabel(booth?.lastHeartbeatAt ?? null, timeZone),
    }}>
      <header className="page-header">
        <div><div className="eyebrow"><Images size={13} /> Session archive</div><h1>Every moment,<br />fully traceable.</h1><p>Data sesi, upload, pembayaran, dan hasil cetak ini dibaca langsung dari database tenant.</p></div>
      </header>
      <section className="panel">
        <div className="panel-header">
          <div><h2>{query ? "Search results" : "All sessions"}</h2><p>{query ? `${sessions.length} hasil dari ${totalSessions} sesi` : `${totalSessions} sesi`} · {printedCopies} copy tercetak pada daftar ini</p></div>
          <form className="session-search" action="/sessions" method="get">
            <Search size={15} />
            <input name="q" aria-label="Cari session" defaultValue={query} placeholder="Kode sesi atau booth" />
            <button className="secondary-button" type="submit">Cari</button>
            {query ? <Link href="/sessions">Reset</Link> : null}
          </form>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Session</th><th>Booth</th><th>Time</th><th>Layout</th><th>Copies</th><th>Payment</th><th>Upload</th><th>Status</th></tr></thead>
            <tbody>
              {sessions.map((session) => {
                const latestUpload = session.uploadJobs[0];
                const paymentStatus = session.order?.payment?.status ?? "NOT_REQUIRED";
                return (
                  <tr key={session.id}>
                    <td className="session-code">{session.publicCode}</td>
                    <td>{session.booth.code} · {session.booth.name}</td>
                    <td>{dateTime(session.startedAt, session.booth.timezone)}</td>
                    <td>{session.layoutVersion?.layout.name ?? "Belum dipilih"}</td>
                    <td>{session.order?.copies ?? 0}</td>
                    <td><span className="status-chip"><span className={`status-dot ${statusClass(paymentStatus)}`} />{paymentStatus}</span></td>
                    <td><span className="status-chip"><span className={`status-dot ${statusClass(latestUpload?.status ?? "WAITING")}`} />{latestUpload?.status ?? "BELUM ADA JOB"}</span></td>
                    <td><span className="status-chip"><span className={`status-dot ${statusClass(session.status)}`} />{session.status}</span></td>
                  </tr>
                );
              })}
              {sessions.length === 0 ? <tr><td colSpan={8}><div className="table-empty">{query ? "Tidak ada sesi yang cocok dengan pencarian." : "Belum ada sesi untuk tenant ini."}</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
