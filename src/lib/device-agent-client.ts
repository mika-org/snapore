import { clearSessionCaptures, saveOfflineCapture, saveOfflineJob } from "@/lib/offline-db";
import { serverApiUrl } from "@/domain/upload-destination";

const agentUrl = process.env.NEXT_PUBLIC_DEVICE_AGENT_URL ?? "http://127.0.0.1:4545";
const onlineServerUrl = process.env.NEXT_PUBLIC_SNAPORE_SERVER_URL;

function onlineApi(path: string) {
  return serverApiUrl(onlineServerUrl, path);
}

export type AgentHealth = {
  online: boolean;
  version?: string;
  storage?: { root: string; freeBytes?: number };
  devices?: Array<{ id: string; fingerprint?: string; type: string; kind?: string; name: string; status: string; capabilities?: Record<string, unknown> }>;
  cameraBridge?: {
    autoSwitch: boolean;
    preferredModel: string;
    connectedDeviceId: string | null;
    connectedDeviceName: string | null;
    status: string;
    error: string | null;
    backend?: { ptpGphoto2: boolean; ptpMode: "native" | "wsl" | null; vendorBridge: boolean };
    sdk?: { canonEdsdk: boolean };
  };
  printerBridge?: {
    configured: PrinterBridgeConfig | null;
    connectedDeviceId: string | null;
    connectedDeviceName: string | null;
    health: { status: string; message?: string; checkedAt: string };
    sdk: { dnp: boolean; epson: boolean };
    paper: { remaining: number; capacity: number; source: "SENSOR" } | null;
  };
};

export type PrinterBridgeConfig = {
  deviceId: string;
  queueName: string;
  kind: string;
  autoConnect: boolean;
  mediaName: string;
  dpi: number;
  borderless: boolean;
  dnpCutQueueName?: string;
};

export type KioskHardwareReport = {
  ok: boolean;
  reportedAt: string;
  camera: { name: string; status: string; kind: string } | null;
  printer: { name: string; status: string; kind: string; queueName: string } | null;
  paper: {
    remaining: number;
    capacity: number;
    lowThreshold: number;
    level: "OK" | "LOW" | "EMPTY" | "UNKNOWN";
    source: "SENSOR" | "ESTIMATED";
    updatedAt: string;
  } | null;
};

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function getAgentHealth(): Promise<AgentHealth> {
  try {
    const response = await fetch(`${agentUrl}/health`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error("Agent tidak siap");
    return { online: true, ...(await response.json()) };
  } catch {
    return { online: false };
  }
}

export async function configureAgentPrinter(input: PrinterBridgeConfig) {
  const response = await fetch(`${agentUrl}/printer/configure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Bridge printer gagal dikonfigurasi");
  return payload;
}

export async function reportKioskHardware(boothId: string, input: {
  kioskInstanceId: string;
  camera?: {
    fingerprint: string;
    name: string;
    status: "ONLINE" | "OFFLINE" | "DEGRADED";
    kind: "MEDIA_DEVICE" | "DSLR_TETHERED";
    driverName?: string | null;
    width?: number;
    height?: number;
  } | null;
  printer?: {
    fingerprint: string;
    deviceId: string;
    name: string;
    status: "ONLINE" | "OFFLINE" | "DEGRADED";
    kind: string;
    driverName?: string | null;
    queueName: string;
    paper?: { remaining: number; capacity: number; sensorBacked: boolean };
  } | null;
}) {
  const response = await fetch(`/api/kiosk/${encodeURIComponent(boothId)}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({})) as Partial<KioskHardwareReport> & { error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Heartbeat hardware kiosk gagal");
  return payload as KioskHardwareReport;
}

export async function captureWithAgentCamera(deviceId: string) {
  const response = await fetch(`${agentUrl}/camera/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
    signal: AbortSignal.timeout(70_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error ?? "Capture kamera tethered gagal");
  }
  return response.blob();
}

export async function previewWithAgentCamera(deviceId: string, signal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(8_000);
  const response = await fetch(`${agentUrl}/camera/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(failure?.error ?? "Preview kamera tethered gagal");
  }
  return response.blob();
}

export async function persistCaptureLocally(input: {
  id: string;
  sessionId: string;
  slotIndex: number;
  blob: Blob;
}) {
  await saveOfflineCapture({ ...input, createdAt: new Date().toISOString(), synced: false }).catch(() => undefined);
  try {
    const dataUrl = await blobToDataUrl(input.blob);
    const response = await fetch(`${agentUrl}/captures`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, blob: undefined, dataUrl }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Agent gagal menyimpan capture");
    return { storage: "directory" as const, ...(await response.json()) };
  } catch {
    return { storage: "indexeddb" as const };
  }
}

export async function clearLocalSessionProgress(sessionId: string) {
  await clearSessionCaptures(sessionId).catch(() => undefined);
  try {
    const response = await fetch(`${agentUrl}/sessions/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function createPrintAndUploadJobs(input: {
  sessionId: string;
  composite: Blob;
  captures: Array<{ id: string; blob: Blob; slotIndex: number; revision: number }>;
  copies: number;
  layoutId: string;
  frameId: string;
  dnpTwoInchCut: boolean;
  boothId: string;
  boothCode: string;
  forceBrowserFallback?: boolean;
}) {
  const printJobId = crypto.randomUUID();
  const uploadJobId = crypto.randomUUID();

  if (!input.forceBrowserFallback) {
    try {
      const compositeDataUrl = await blobToDataUrl(input.composite);
      const response = await fetch(`${agentUrl}/jobs/print`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, composite: undefined, captures: undefined, compositeDataUrl, printJobId, uploadJobId }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Agent gagal membuat job");
      return { mode: "agent" as const, ...(await response.json()) };
    } catch {
      // Browser fallback below keeps the exact in-memory capture selection.
    }
  }

  await Promise.all([
    saveOfflineJob({
      id: printJobId,
      sessionId: input.sessionId,
      type: "PRINT",
      status: "QUEUED",
      payload: { composite: input.composite, copies: input.copies, layoutId: input.layoutId, frameId: input.frameId, dnpTwoInchCut: input.dnpTwoInchCut },
      createdAt: new Date().toISOString(),
    }),
    saveOfflineJob({
      id: uploadJobId,
      sessionId: input.sessionId,
      type: "UPLOAD",
      status: "QUEUED",
      payload: { trigger: "PRINT_CONFIRMED" },
      createdAt: new Date().toISOString(),
    }),
  ]);

  try {
    const sync = await syncSessionFromBrowser({ ...input, printJobId, uploadJobId });
    return { mode: "browser-fallback" as const, printJobId, uploadJobId, ...sync };
  } catch (syncError) {
    return {
      mode: "browser-fallback" as const,
      printJobId,
      uploadJobId,
      syncStatus: "RETRYING" as const,
      syncError: syncError instanceof Error ? syncError.message : "Sinkronisasi browser gagal",
    };
  }
}

export async function syncSessionFromBrowser(input: {
  sessionId: string;
  composite: Blob;
  captures: Array<{ id: string; blob: Blob; slotIndex: number; revision: number }>;
  copies: number;
  layoutId: string;
  frameId: string;
  dnpTwoInchCut: boolean;
  boothId: string;
  boothCode: string;
  printJobId: string;
  uploadJobId: string;
}) {
  const form = new FormData();
  form.set("sessionId", input.sessionId);
  form.set("boothId", input.boothId);
  form.set("boothCode", input.boothCode);
  form.set("uploadJobId", input.uploadJobId);
  form.set("manifest", JSON.stringify({
    source: "BROWSER_FALLBACK",
    layoutId: input.layoutId,
    frameId: input.frameId,
    dnpTwoInchCut: input.dnpTwoInchCut,
    captures: input.captures.map(({ id, slotIndex, revision }) => ({ id, slotIndex, revision, active: true })),
    printJob: { id: input.printJobId, copies: input.copies, status: "QUEUED", dnpTwoInchCut: input.dnpTwoInchCut },
  }));
  input.captures.forEach((capture) => {
    const extension = capture.blob.type === "image/png" ? "png" : capture.blob.type === "image/webp" ? "webp" : "jpg";
    form.append("assets", capture.blob, `${capture.id}.${extension}`);
  });
  const compositeExtension = input.composite.type === "image/png" ? "png" : input.composite.type === "image/webp" ? "webp" : "jpg";
  form.append("assets", input.composite, `composite-${input.printJobId}.${compositeExtension}`);

  const response = await fetch(onlineApi("/api/sync/sessions"), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => ({})) as { status?: string; galleryUrl?: string; error?: string; detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? `Sinkronisasi merespons ${response.status}`);
  return { syncStatus: payload.status ?? "SYNCED", galleryUrl: payload.galleryUrl };
}

export async function getServerSyncStatus(boothId: string, sessionId: string) {
  try {
    const query = new URLSearchParams({ boothId, sessionId });
    const response = await fetch(`${onlineApi("/api/sync/sessions")}?${query.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await response.json() as { status: string; galleryUrl?: string; lastError?: string | null };
  } catch {
    return null;
  }
}

export async function getAgentJobs(sessionId: string) {
  try {
    const response = await fetch(`${agentUrl}/jobs`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!response.ok) return null;
    const jobs = await response.json() as {
      printJobs: Array<{ id: string; sessionId: string; status: string; error?: string }>;
      uploadJobs: Array<{ id: string; sessionId: string; status: string; galleryUrl?: string; lastError?: string }>;
    };
    return {
      print: jobs.printJobs.find((job) => job.sessionId === sessionId),
      upload: jobs.uploadJobs.find((job) => job.sessionId === sessionId),
    };
  } catch {
    return null;
  }
}

export async function retryAgentUploadWithBooth(input: { uploadJobId: string; boothId: string; boothCode: string }) {
  const response = await fetch(`${agentUrl}/jobs/upload/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "Upload job gagal dijadwalkan ulang");
  return payload;
}
