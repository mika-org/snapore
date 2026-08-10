"use client";

import { Cable, CheckCircle2, Layers3, LoaderCircle, Printer, RefreshCcw, Scissors, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { configureAgentPrinter, getAgentHealth, type AgentHealth, type PrinterBridgeConfig } from "@/lib/device-agent-client";

type RegisteredPrinter = {
  fingerprint: string;
  name: string;
  driverName: string | null;
  preferred: boolean;
  kind: string;
  queueName: string | null;
  dnpCutQueueName: string | null;
  autoConnect: boolean;
  mediaName: string;
  dpi: number;
  borderless: boolean;
  currentSheets: number;
  paperCapacity: number;
  lowPaperThreshold: number;
  paperInitialized: boolean;
  sensorBacked: boolean;
};

export function PrinterBridgeMonitor({ boothId, registeredPrinters, canEdit }: {
  boothId: string;
  registeredPrinters: RegisteredPrinter[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const preferred = registeredPrinters.find((printer) => printer.preferred) ?? registeredPrinters[0];
  const [health, setHealth] = useState<AgentHealth>({ online: false });
  const [selectedId, setSelectedId] = useState("");
  const [autoConnect, setAutoConnect] = useState(preferred?.autoConnect ?? true);
  const [mediaName, setMediaName] = useState(preferred?.mediaName ?? "4x6");
  const [dpi, setDpi] = useState(preferred?.dpi ?? 300);
  const [borderless, setBorderless] = useState(preferred?.borderless ?? true);
  const [dnpCutQueueName, setDnpCutQueueName] = useState(preferred?.dnpCutQueueName ?? "");
  const [currentSheets, setCurrentSheets] = useState(preferred?.currentSheets ?? 0);
  const [paperCapacity, setPaperCapacity] = useState(preferred?.paperCapacity ?? 400);
  const [lowPaperThreshold, setLowPaperThreshold] = useState(preferred?.lowPaperThreshold ?? 20);
  const [paperInitialized, setPaperInitialized] = useState(preferred?.paperInitialized ?? false);
  const [paperSensorBacked, setPaperSensorBacked] = useState(preferred?.sensorBacked ?? false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const loadHealth = useCallback(async () => {
    const next = await getAgentHealth();
    setHealth(next);
    const printers = (next.devices ?? []).filter((device) => device.type === "PRINTER");
    setSelectedId((current) => {
      if (current && printers.some((device) => device.id === current)) return current;
      const configured = next.printerBridge?.configured;
      const storedQueue = preferred?.queueName;
      return printers.find((device) => device.id === configured?.deviceId)?.id
        ?? printers.find((device) => device.name === storedQueue)?.id
        ?? printers.find((device) => device.kind === "DNP" && device.status !== "OFFLINE")?.id
        ?? printers.find((device) => device.kind === "EPSON" && device.status !== "OFFLINE")?.id
        ?? printers[0]?.id
        ?? "";
    });
  }, [preferred?.queueName]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadHealth(), 0);
    const timer = window.setInterval(() => void loadHealth(), 5_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadHealth]);

  const livePrinters = useMemo(() => (health.devices ?? []).filter((device) => device.type === "PRINTER"), [health.devices]);
  const selected = livePrinters.find((device) => device.id === selectedId);
  const selectedKind = selected?.kind ?? preferred?.kind ?? "OS_SPOOLER";
  const active = health.printerBridge;
  const dnpCutReady = selectedKind !== "DNP"
    || Boolean(active?.sdk.dnp)
    || Boolean(dnpCutQueueName.trim())
    || /2\s*inch|2inch|cut/i.test(selected?.name ?? "");
  const paperLevel = !paperInitialized ? "UNKNOWN" : currentSheets <= 0 ? "EMPTY" : currentSheets <= lowPaperThreshold ? "LOW" : "OK";

  const choosePrinter = (deviceId: string) => {
    setSelectedId(deviceId);
    const device = livePrinters.find((candidate) => candidate.id === deviceId);
    const stored = registeredPrinters.find((candidate) => candidate.queueName === device?.name);
    if (stored) {
      setAutoConnect(stored.autoConnect);
      setMediaName(stored.mediaName);
      setDpi(stored.dpi);
      setBorderless(stored.borderless);
      setDnpCutQueueName(stored.dnpCutQueueName ?? "");
      setCurrentSheets(stored.currentSheets);
      setPaperCapacity(stored.paperCapacity);
      setLowPaperThreshold(stored.lowPaperThreshold);
      setPaperInitialized(stored.paperInitialized);
      setPaperSensorBacked(stored.sensorBacked);
    } else {
      setAutoConnect(true);
      setMediaName("4x6");
      setDpi(device?.kind === "EPSON" ? 600 : 300);
      setBorderless(true);
      setDnpCutQueueName("");
      setCurrentSheets(0);
      setPaperCapacity(400);
      setLowPaperThreshold(20);
      setPaperInitialized(false);
      setPaperSensorBacked(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) {
      setFeedback({ kind: "error", text: "Pilih printer yang terdeteksi oleh device agent." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const queueName = String(selected.capabilities?.queueName ?? selected.name);
    const driverName = String(selected.capabilities?.driverName ?? "Windows printer driver");
    const config: PrinterBridgeConfig = {
      deviceId: selected.id,
      queueName,
      kind: selected.kind ?? "OS_SPOOLER",
      autoConnect,
      mediaName,
      dpi,
      borderless,
      dnpCutQueueName: dnpCutQueueName.trim() || undefined,
    };
    try {
      await configureAgentPrinter(config);
      const response = await fetch("/api/tenant/configuration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "savePrinterBridge",
          boothId,
          fingerprint: selected.fingerprint ?? selected.id,
          ...config,
          name: selected.name,
          driverName,
          dnpCutQueueName: config.dnpCutQueueName ?? null,
          currentSheets,
          paperCapacity,
          lowPaperThreshold,
          paperInitialized,
          paperSensorBacked,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Konfigurasi printer gagal disimpan ke database.");
      setFeedback({ kind: "success", text: result.message ?? `${selected.name} berhasil auto-connect.` });
      await loadHealth();
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Printer bridge gagal dikonfigurasi." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`printer-bridge-monitor ${health.online ? "agent-online" : "agent-offline"}`}>
      <header>
        <div>
          <span className="printer-bridge-eyebrow"><Cable size={14} /> AUTO-CONNECT PRINTER BRIDGE</span>
          <h3>{active?.connectedDeviceName ?? (health.online ? "Pilih printer foto" : "Device agent belum aktif")}</h3>
          <p>{health.online
            ? `${livePrinters.length} queue fisik terdeteksi · monitor diperbarui setiap 5 detik`
            : "Jalankan npm run agent:dev pada PC booth untuk mendeteksi DNP atau Epson secara otomatis."}</p>
        </div>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void loadHealth()}><RefreshCcw size={14} className={busy ? "spin" : undefined} /> Scan ulang</button>
      </header>

      <div className="printer-bridge-status-grid">
        <div><span>Agent lokal</span><strong><i className={`status-dot ${health.online ? "online" : "error"}`} /> {health.online ? `ONLINE · v${health.version ?? "-"}` : "OFFLINE"}</strong></div>
        <div><span>Koneksi printer</span><strong><i className={`status-dot ${active?.health.status === "ONLINE" ? "online" : "warn"}`} /> {active?.health.status ?? "BELUM TERHUBUNG"}</strong></div>
        <div><span>Driver / SDK</span><strong>{selectedKind === "DNP" ? (active?.sdk.dnp ? "DNP SDK BRIDGE" : "DNP WINDOWS DRIVER") : selectedKind === "EPSON" ? (active?.sdk.epson ? "EPSON SDK BRIDGE" : "EPSON WINDOWS DRIVER") : "WINDOWS SPOOLER"}</strong></div>
        <div><span>DNP 2 inch cut</span><strong className={dnpCutReady ? "ready" : "attention"}>{dnpCutReady ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />} {selectedKind === "DNP" ? (dnpCutReady ? "SIAP" : "PERLU SDK / CUT QUEUE") : "KHUSUS DNP"}</strong></div>
        <div><span>Sisa kertas · {paperSensorBacked ? "sensor" : "estimasi"}</span><strong className={paperLevel === "OK" ? "ready" : "attention"}><Layers3 size={15} /> {paperLevel === "UNKNOWN" ? "BELUM DIISI" : `${currentSheets} / ${paperCapacity} · ${paperLevel}`}</strong></div>
      </div>

      <form className="printer-bridge-form" onSubmit={save}>
        <label className="config-field printer-queue-field">
          <span>Printer foto yang digunakan</span>
          <select value={selectedId} onChange={(event) => choosePrinter(event.target.value)} disabled={!canEdit || !health.online || busy} required>
            <option value="">Pilih queue printer...</option>
            {livePrinters.map((device) => <option value={device.id} key={device.id}>{device.name} · {device.kind} · {device.status}</option>)}
          </select>
          <small>{selected ? String(selected.capabilities?.driverName ?? "Windows printer driver") : "DNP diprioritaskan, lalu Epson photo printer."}</small>
        </label>
        <label className="config-field"><span>Media</span><select value={mediaName} onChange={(event) => setMediaName(event.target.value)} disabled={!canEdit || busy}><option value="4x6">4×6 photo</option><option value="5x7">5×7 photo</option><option value="6x8">6×8 photo</option><option value="A6">A6 photo</option><option value="A4">A4 photo</option></select></label>
        <label className="config-field"><span>DPI</span><input type="number" min={150} max={1200} step={50} value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={!canEdit || busy} /></label>
        <label className="printer-bridge-check"><input type="checkbox" checked={autoConnect} onChange={(event) => setAutoConnect(event.target.checked)} disabled={!canEdit || busy} /><span><strong>Auto-connect</strong><small>Sambungkan kembali otomatis tiap 5 detik.</small></span></label>
        <label className="printer-bridge-check"><input type="checkbox" checked={borderless} onChange={(event) => setBorderless(event.target.checked)} disabled={!canEdit || busy} /><span><strong>Borderless</strong><small>Cetak foto memenuhi media.</small></span></label>

        {selectedKind === "DNP" ? <label className="config-field dnp-cut-queue-field"><span><Scissors size={14} /> Queue khusus DNP 2 inch cut</span><input value={dnpCutQueueName} onChange={(event) => setDnpCutQueueName(event.target.value)} disabled={!canEdit || busy || Boolean(active?.sdk.dnp)} placeholder={active?.sdk.dnp ? "Ditangani SDK bridge" : "Contoh: DNP DS-RX1 2inch CUT"} /><small>Isi queue Windows duplikat dengan opsi driver “2inch cut” aktif. Jika SDK bridge tersedia, field ini tidak diperlukan.</small></label> : null}

        <section className={`paper-counter-setting ${paperLevel.toLowerCase()}`}>
          <header><div><Layers3 size={18} /><span><strong>Paper counter per kiosk</strong><small>{paperSensorBacked ? "Jumlah dikirim SDK/sensor printer dan tidak perlu dihitung manual." : "Estimasi berkurang otomatis sesuai jumlah copy yang berhasil masuk alur cetak."}</small></span></div><em>{paperLevel}</em></header>
          <div>
            <label className="config-field"><span>Sisa lembar saat ini</span><input type="number" min={0} max={100000} value={currentSheets} onChange={(event) => { setCurrentSheets(Math.max(0, Number(event.target.value))); setPaperInitialized(true); }} disabled={!canEdit || busy || paperSensorBacked} /></label>
            <label className="config-field"><span>Kapasitas media</span><input type="number" min={1} max={100000} value={paperCapacity} onChange={(event) => setPaperCapacity(Math.max(1, Number(event.target.value)))} disabled={!canEdit || busy || paperSensorBacked} /></label>
            <label className="config-field"><span>Notifikasi menipis ≤</span><input type="number" min={1} max={10000} value={lowPaperThreshold} onChange={(event) => setLowPaperThreshold(Math.max(1, Number(event.target.value)))} disabled={!canEdit || busy} /></label>
          </div>
        </section>

        {feedback ? <div className={`frame-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</div> : null}
        <button className="primary-button printer-bridge-save" type="submit" disabled={!canEdit || !health.online || !selected || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Printer size={16} />} {busy ? "Menghubungkan..." : "Simpan & hubungkan"}</button>
      </form>
    </article>
  );
}
