"use client";

import { useRouter } from "next/navigation";
import {
  Camera,
  CircleDollarSign,
  Clock3,
  Film,
  Frame,
  LoaderCircle,
  Monitor,
  Power,
  Printer,
  RefreshCcw,
  Save,
  ShieldAlert,
  Tablet,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { FrameManager } from "@/components/frame-manager";

type BoothData = {
  id: string;
  code: string;
  name: string;
  status: string;
  kioskEnabled: boolean;
  maintenanceMode: boolean;
  resourceReady: boolean;
  readinessReason: string | null;
  layoutCounts: number[];
  devices: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    preferred: boolean;
    detail: string;
    lastSeenLabel: string | null;
  }>;
  pricing: null | {
    id: string;
    name: string;
    basePrice: number;
    additionalCopy: number;
    taxRate: number;
  };
  setting: null | {
    countdownSeconds: number;
    maxRetakes: number;
    idleTimeoutSeconds: number;
    paymentMode: "DISABLED" | "CASH" | "MANUAL" | "ONLINE_PROVIDER";
    unprintedRetentionHours: number;
    syncedRetentionDays: number;
  };
  idleMedia: Array<{ id: string; title: string; mediaType: string; durationMs: number; active: boolean }>;
};

type LayoutData = { id: string; name: string; kind: string; publishedVersion: number | null };
type PaymentData = { enabled: boolean; environment: string; configured: boolean };

function statusClass(status: string) {
  if (status === "ONLINE") return "online";
  if (status === "DEGRADED" || status === "PAIRING") return "warn";
  return "error";
}

function deviceIcon(type: string) {
  if (type === "CAMERA") return Camera;
  if (type === "PRINTER") return Printer;
  if (type === "TABLET") return Tablet;
  return Monitor;
}

function BoothConfiguration({ booth, booths, layouts, payment, canEdit, onBoothChange }: { booth: BoothData; booths: BoothData[]; layouts: LayoutData[]; payment: PaymentData; canEdit: boolean; onBoothChange: (boothId: string) => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState<"pricing" | "settings" | "availability" | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>, kind: "pricing" | "settings") => {
    event.preventDefault();
    setSaving(kind);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    const payload = kind === "pricing"
      ? {
          action: "savePricing",
          boothId: booth.id,
          name: form.get("name"),
          basePrice: form.get("basePrice"),
          additionalCopy: form.get("additionalCopy"),
          taxRate: form.get("taxRate"),
        }
      : {
          action: "saveBoothSettings",
          boothId: booth.id,
          countdownSeconds: form.get("countdownSeconds"),
          maxRetakes: form.get("maxRetakes"),
          idleTimeoutSeconds: form.get("idleTimeoutSeconds"),
          paymentMode: form.get("paymentMode"),
          unprintedRetentionHours: form.get("unprintedRetentionHours"),
          syncedRetentionDays: form.get("syncedRetentionDays"),
        };

    try {
      const response = await fetch("/api/tenant/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Konfigurasi gagal disimpan.");
      setFeedback({ kind: "success", text: kind === "pricing" ? "Harga booth tersimpan ke database." : "Pengaturan booth tersimpan ke database." });
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Konfigurasi gagal disimpan." });
    } finally {
      setSaving(null);
    }
  };

  const operational = booth.kioskEnabled && !booth.maintenanceMode && booth.resourceReady;
  const updateAvailability = async () => {
    setSaving("availability");
    setFeedback(null);
    try {
      const response = await fetch("/api/tenant/configuration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setBoothEnabled", boothId: booth.id, enabled: !booth.kioskEnabled }),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Status booth gagal disimpan.");
      setFeedback({ kind: "success", text: result.message ?? "Status booth berhasil disimpan." });
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Status booth gagal disimpan." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="cms-grid">
      <div>
        <FrameManager booths={booths.map((item) => ({ id: item.id, code: item.code, name: item.name }))} canEdit={canEdit} selectedBoothId={booth.id} onBoothChange={onBoothChange} />
        <section id="devices">
        <div className="section-heading">
          <div><h2>Devices</h2><p>{booth.devices.length} perangkat terdaftar pada {booth.code}</p></div>
          <button className="secondary-button" type="button" onClick={() => router.refresh()}><RefreshCcw size={14} /> Refresh data</button>
        </div>
        <article className="panel">
          <div className="panel-body">
            {booth.devices.map((device) => {
              const Icon = deviceIcon(device.type);
              return (
                <div className="device-row" key={device.id}>
                  <span className="device-row-icon"><Icon size={18} /></span>
                  <div><strong>{device.name}{device.preferred ? " · preferred" : ""}</strong><span>{device.detail}{device.lastSeenLabel ? ` · ${device.lastSeenLabel}` : " · belum ada heartbeat"}</span></div>
                  <span className="status-chip"><span className={`status-dot ${statusClass(device.status)}`} /> {device.status}</span>
                </div>
              );
            })}
            {booth.devices.length === 0 ? <div className="inline-empty">Belum ada perangkat terdaftar. Jalankan dan hubungkan local device agent untuk mendaftarkan kamera atau printer.</div> : null}
          </div>
        </article>
        </section>
      </div>

      <aside className="settings-stack">
        {feedback ? <div className={`frame-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</div> : null}
        <section className={`settings-card booth-availability-card ${operational ? "operational" : "maintenance"}`}>
          <h3>{operational ? <Power size={17} /> : <ShieldAlert size={17} />} Status booth · {booth.code}</h3>
          <div className="booth-availability-summary"><div><strong>{operational ? "Aktif" : booth.maintenanceMode ? "Maintenance" : "Nonaktif"}</strong><span>{operational ? "Kiosk siap menerima sesi baru." : booth.readinessReason ?? "Booth dinonaktifkan oleh admin."}</span></div><span className={`status-dot ${operational ? "online" : "warn"}`} /></div>
          <p className="settings-note">Layout tersedia: {booth.layoutCounts.length ? booth.layoutCounts.join(" / ") : "belum ada"}. Booth tanpa layout-frame yang cocok otomatis maintenance.</p>
          <button className={`booth-availability-action ${booth.kioskEnabled ? "disable" : "enable"}`} type="button" disabled={!canEdit || saving !== null} onClick={() => void updateAvailability()}>{saving === "availability" ? <LoaderCircle className="spin" size={15} /> : <Power size={15} />} {booth.kioskEnabled ? "Nonaktifkan booth" : "Aktifkan booth"}</button>
        </section>
        <section className="settings-card">
          <h3><Frame size={17} /> Published layouts</h3>
          {layouts.map((layout) => (
            <div className="form-row" key={layout.id}>
              <label><strong>{layout.name}</strong><span>{layout.kind.replace("_", " ")}</span></label>
              <span className="database-badge">{layout.publishedVersion ? `V${layout.publishedVersion}` : "OFF"}</span>
            </div>
          ))}
          {layouts.length === 0 ? <div className="card-empty">Belum ada layout aktif di database.</div> : null}
        </section>

        <form className="settings-card" id="pricing" onSubmit={(event) => void submit(event, "pricing")}>
          <h3><CircleDollarSign size={17} /> Pricing · {booth.code}</h3>
          {!booth.pricing ? <p className="settings-note">Belum ada pricing rule. Isi form ini untuk membuat aturan harga booth.</p> : null}
          <label className="config-field"><span>Nama paket</span><input name="name" defaultValue={booth.pricing?.name ?? ""} placeholder="Nama paket" minLength={2} maxLength={80} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Harga dasar (IDR)</span><input name="basePrice" type="number" min={0} step={100} defaultValue={booth.pricing?.basePrice ?? ""} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Copy tambahan (IDR)</span><input name="additionalCopy" type="number" min={0} step={100} defaultValue={booth.pricing?.additionalCopy ?? ""} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Pajak (%)</span><input name="taxRate" type="number" min={0} max={100} step={0.01} defaultValue={booth.pricing?.taxRate ?? ""} required disabled={!canEdit} /></label>
          <button className="primary-button config-save" type="submit" disabled={!canEdit || saving !== null}>{saving === "pricing" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Save pricing</button>
        </form>

        <form className="settings-card" id="settings" onSubmit={(event) => void submit(event, "settings")}>
          <h3><Clock3 size={17} /> Booth settings · {booth.code}</h3>
          {!booth.setting ? <p className="settings-note">Belum ada konfigurasi booth. Nilai berikut menjadi konfigurasi awal ketika disimpan.</p> : null}
          <label className="config-field"><span>Countdown foto (detik)</span><input name="countdownSeconds" type="number" min={1} max={30} defaultValue={booth.setting?.countdownSeconds ?? 3} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Maksimum retake</span><input name="maxRetakes" type="number" min={0} max={20} defaultValue={booth.setting?.maxRetakes ?? 1} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Idle timeout (detik)</span><input name="idleTimeoutSeconds" type="number" min={30} max={3600} defaultValue={booth.setting?.idleTimeoutSeconds ?? 90} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Mode pembayaran</span><select name="paymentMode" defaultValue={booth.setting?.paymentMode ?? "DISABLED"} disabled={!canEdit}><option value="DISABLED">Disabled</option><option value="CASH" disabled>Cash (belum tersedia)</option><option value="MANUAL" disabled>Manual (belum tersedia)</option><option value="ONLINE_PROVIDER">Xendit QRIS</option></select></label>
          <label className="config-field"><span>Retensi belum tercetak (jam)</span><input name="unprintedRetentionHours" type="number" min={1} max={720} defaultValue={booth.setting?.unprintedRetentionHours ?? 24} required disabled={!canEdit} /></label>
          <label className="config-field"><span>Retensi tersinkron (hari)</span><input name="syncedRetentionDays" type="number" min={1} max={365} defaultValue={booth.setting?.syncedRetentionDays ?? 7} required disabled={!canEdit} /></label>
          <button className="primary-button config-save" type="submit" disabled={!canEdit || saving !== null}>{saving === "settings" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} Save settings</button>
        </form>

        <section className="settings-card">
          <h3><Film size={17} /> Idle media</h3>
          {booth.idleMedia.map((media) => (
            <div className="form-row" key={media.id}><label><strong>{media.title}</strong><span>{media.mediaType} · {Math.round(media.durationMs / 1000)} detik</span></label><span className="database-badge">{media.active ? "ON" : "OFF"}</span></div>
          ))}
          {booth.idleMedia.length === 0 ? <div className="card-empty">Belum ada idle media untuk booth ini.</div> : null}
        </section>

        <section className="settings-card">
          <h3><CircleDollarSign size={17} /> Xendit QRIS</h3>
          <div className="form-row"><label><strong>{payment.enabled ? "Aktif" : "Tidak aktif"}</strong><span>Environment: {payment.environment}</span></label><span className={`status-dot ${payment.enabled && payment.configured ? "online" : "warn"}`} /></div>
          <p className="settings-note">API key dikelola oleh Super Admin dan tidak ditampilkan pada akun tenant.</p>
        </section>

        {!canEdit ? <section className="settings-card"><p className="settings-note">Akun {""}<strong>ADMIN</strong> diperlukan untuk mengubah konfigurasi. Akun ini memiliki akses baca.</p></section> : null}
      </aside>
    </div>
  );
}

export function TenantConfiguration({ booths, layouts, payment, canEdit }: { booths: BoothData[]; layouts: LayoutData[]; payment: PaymentData; canEdit: boolean }) {
  const [boothId, setBoothId] = useState(booths[0]?.id ?? "");
  const booth = booths.find((item) => item.id === boothId) ?? booths[0] ?? null;

  return (
    <>
      <div className="configuration-toolbar">
        <label><span>Booth workspace</span><select value={booth?.id ?? ""} onChange={(event) => setBoothId(event.target.value)} disabled={booths.length === 0}>{booths.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label>
        {booth ? <span className="status-chip"><span className={`status-dot ${statusClass(booth.status)}`} /> {booth.status}</span> : null}
      </div>
      {booth
        ? <BoothConfiguration key={booth.id} booth={booth} booths={booths} layouts={layouts} payment={payment} canEdit={canEdit} onBoothChange={setBoothId} />
        : <div className="cms-grid">
            <div>
              <FrameManager booths={[]} canEdit={false} />
              <section id="devices">
                <div className="section-heading"><div><h2>Devices</h2><p>Perangkat kamera dan printer tenant</p></div></div>
                <article className="panel"><div className="panel-body"><div className="inline-empty">Belum ada perangkat karena tenant belum memiliki booth. Buat booth dari menu Super Admin → Booth & kiosk.</div></div></article>
              </section>
            </div>
            <aside className="settings-stack">
              <section className="settings-card" id="pricing">
                <h3><CircleDollarSign size={17} /> Pricing</h3>
                <div className="inline-empty">Pricing dapat diatur setelah Super Admin membuat booth untuk tenant ini.</div>
              </section>
              <section className="settings-card" id="settings">
                <h3><Clock3 size={17} /> Booth settings</h3>
                <div className="inline-empty">Countdown, retake, pembayaran, dan retensi tersedia setelah booth dibuat.</div>
              </section>
            </aside>
          </div>}
    </>
  );
}
