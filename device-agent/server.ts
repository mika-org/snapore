import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { MockPrinterAdapter, OsSpoolerPrinterAdapter } from "./adapters";
import { SdkBridgeCameraAdapter } from "./camera-adapters";
import type { CameraAdapter, DiscoveredDevice, PrinterAdapter } from "./contracts";

const port = Number(process.env.SNAPORE_AGENT_PORT ?? 4545);
const dataRoot = resolve(process.env.SNAPORE_DATA_DIR ?? "./snapore-data");
const statePath = join(dataRoot, "agent-state.json");
const serverUrl = process.env.SNAPORE_SERVER_URL ?? "http://localhost:3000";
const deviceToken = process.env.SNAPORE_DEVICE_TOKEN ?? "";
const requireToken = process.env.SNAPORE_REQUIRE_AGENT_TOKEN === "true";
const boothCode = process.env.SNAPORE_BOOTH_CODE ?? "BKK-001";

type CaptureRecord = {
  id: string;
  sessionId: string;
  slotIndex: number;
  path: string;
  checksum: string;
  mimeType: string;
  active: boolean;
  revision: number;
  createdAt: string;
};

type PrintJobRecord = {
  id: string;
  sessionId: string;
  path: string;
  copies: number;
  status: "QUEUED" | "PRINTING" | "PRINTED" | "FAILED";
  spoolerId?: string;
  error?: string;
  profile?: {
    mediaName: string;
    dpi: number;
    orientation: "portrait" | "landscape";
    borderless: boolean;
    photoPaper: boolean;
    dnpTwoInchCut: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

type UploadJobRecord = {
  id: string;
  sessionId: string;
  status: "QUEUED" | "UPLOADING" | "SYNCED" | "RETRYING";
  attempts: number;
  nextRetryAt?: string;
  galleryUrl?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

type AgentState = {
  captures: CaptureRecord[];
  printJobs: PrintJobRecord[];
  uploadJobs: UploadJobRecord[];
  printerConfig?: PrinterBridgeConfig;
};

type PrinterBridgeConfig = {
  deviceId: string;
  queueName: string;
  kind: string;
  autoConnect: boolean;
  mediaName: string;
  dpi: number;
  borderless: boolean;
  dnpCutQueueName?: string;
};

const initialState: AgentState = { captures: [], printJobs: [], uploadJobs: [] };
let stateWrite = Promise.resolve();

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Identifier tidak valid");
  return value;
}

function sessionDirectory(sessionId: string) {
  const date = new Date().toISOString().slice(0, 10);
  return join(dataRoot, boothCode, date, safeSegment(sessionId));
}

async function ensureRoot() {
  await mkdir(dataRoot, { recursive: true });
}

async function loadState(): Promise<AgentState> {
  await ensureRoot();
  try {
    const stored = JSON.parse(await readFile(statePath, "utf8")) as Partial<AgentState>;
    return {
      captures: Array.isArray(stored.captures) ? stored.captures : [],
      printJobs: Array.isArray(stored.printJobs) ? stored.printJobs : [],
      uploadJobs: Array.isArray(stored.uploadJobs) ? stored.uploadJobs : [],
      printerConfig: stored.printerConfig,
    };
  } catch {
    return structuredClone(initialState);
  }
}

async function saveState(state: AgentState) {
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  stateWrite = stateWrite.then(async () => {
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await rename(temporary, statePath);
  });
  return stateWrite;
}

async function atomicWrite(destination: string, bytes: Buffer) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Format gambar tidak didukung");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 30 * 1024 * 1024) throw new Error("Ukuran gambar tidak valid");
  return { mimeType: match[1], bytes };
}

function extensionFor(mimeType: string) {
  return mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader("access-control-allow-origin", origin);
  }
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-snapore-device-token");
  res.setHeader("vary", "Origin");
}

function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 40 * 1024 * 1024) throw new Error("Request terlalu besar");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function authorized(req: IncomingMessage) {
  return !requireToken || Boolean(deviceToken && req.headers["x-snapore-device-token"] === deviceToken);
}

const printer: PrinterAdapter = process.env.SNAPORE_PRINTER_MODE === "mock"
  ? new MockPrinterAdapter()
  : new OsSpoolerPrinterAdapter();
const cameras: CameraAdapter[] = [
  ...(process.env.SNAPORE_CANON_SDK_BRIDGE ? [new SdkBridgeCameraAdapter("CANON_EDSDK", process.env.SNAPORE_CANON_SDK_BRIDGE)] : []),
  ...(process.env.SNAPORE_CAMERA_SDK_BRIDGE ? [new SdkBridgeCameraAdapter(process.env.SNAPORE_CAMERA_SDK_KIND ?? "VENDOR_SDK", process.env.SNAPORE_CAMERA_SDK_BRIDGE)] : []),
];

async function discoverSdkCameras() {
  const discovered: Array<{ adapter: CameraAdapter; device: DiscoveredDevice }> = [];
  for (const adapter of cameras) {
    const devices = await adapter.discover().catch(() => []);
    devices.forEach((device) => discovered.push({ adapter, device }));
  }
  return discovered;
}

function photoPrinterRank(device: DiscoveredDevice) {
  if (device.status === "OFFLINE") return 100;
  if (device.kind === "DNP") return 0;
  if (device.kind === "EPSON") return 1;
  if (device.kind === "OS_SPOOLER") return 2;
  if (device.kind === "MOCK") return 3;
  return 50;
}

async function ensurePrinterConnected(options: { requireDnp?: boolean; respectAutoConnect?: boolean } = {}) {
  const [state, devices] = await Promise.all([loadState(), printer.discover()]);
  const config = state.printerConfig;
  if (options.respectAutoConnect && config?.autoConnect === false) {
    return { device: undefined, config, health: await printer.getHealth() };
  }

  const candidates = devices
    .filter((device) => device.type === "PRINTER" && (!options.requireDnp || device.kind === "DNP"))
    .sort((left, right) => photoPrinterRank(left) - photoPrinterRank(right));
  const configured = config
    ? candidates.find((device) => device.id === config.deviceId || device.name === config.queueName)
    : undefined;
  const selected = configured ?? candidates.find((device) => device.status !== "OFFLINE");
  if (!selected) {
    if (options.requireDnp) throw new Error("Frame ini meminta DNP 2-inch cut, tetapi queue DNP belum ditemukan");
    throw new Error("Tidak ada printer foto kompatibel yang ditemukan");
  }

  await printer.connect(selected.id);
  return { device: selected, config, health: await printer.getHealth() };
}

async function processPrintJob(jobId: string) {
  const state = await loadState();
  const job = state.printJobs.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "QUEUED") return;
  job.status = "PRINTING";
  job.updatedAt = new Date().toISOString();
  await saveState(state);

  try {
    const profile = job.profile ?? {
      mediaName: "4x6",
      dpi: 300,
      orientation: "portrait" as const,
      borderless: true,
      photoPaper: true,
      dnpTwoInchCut: false,
    };
    const { config, device } = await ensurePrinterConnected({ requireDnp: profile.dnpTwoInchCut });
    const selectedConfig = config && device && (config.deviceId === device.id || config.queueName === device.name) ? config : undefined;
    const result = await printer.print({
      jobId: job.id,
      filePath: job.path,
      copies: job.copies,
      profile: {
        mediaName: selectedConfig?.mediaName || profile.mediaName || "4x6",
        dpi: selectedConfig?.dpi || profile.dpi || 300,
        orientation: profile.orientation,
        borderless: selectedConfig?.borderless ?? profile.borderless ?? true,
        photoPaper: profile.photoPaper,
        queueName: selectedConfig?.queueName ?? device?.name,
        dnpCutQueueName: selectedConfig?.dnpCutQueueName,
        dnpTwoInchCut: profile.dnpTwoInchCut,
      },
    });
    job.status = result.status === "PRINTED" ? "PRINTED" : "PRINTING";
    job.spoolerId = result.spoolerId;
  } catch (error) {
    job.status = "FAILED";
    job.error = error instanceof Error ? error.message : "Unknown print error";
  }
  job.updatedAt = new Date().toISOString();
  await saveState(state);
}

async function processUploadQueue() {
  const state = await loadState();
  const now = Date.now();
  const job = state.uploadJobs.find(
    (candidate) =>
      (candidate.status === "QUEUED" || candidate.status === "RETRYING") &&
      (!candidate.nextRetryAt || new Date(candidate.nextRetryAt).getTime() <= now),
  );
  if (!job) return;

  job.status = "UPLOADING";
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  await saveState(state);

  try {
    const captures = state.captures.filter((capture) => capture.sessionId === job.sessionId && capture.active !== false);
    const printJob = state.printJobs.find((candidate) => candidate.sessionId === job.sessionId);
    if (!printJob) throw new Error("Composite print tidak ditemukan");

    const form = new FormData();
    form.set("sessionId", job.sessionId);
    form.set("boothCode", boothCode);
    form.set("uploadJobId", job.id);
    form.set("manifest", JSON.stringify({ captures, printJob }));
    for (const capture of captures) {
      const bytes = await readFile(capture.path);
      form.append("assets", new Blob([bytes], { type: capture.mimeType }), `${capture.id}${extname(capture.path)}`);
    }
    const compositeBytes = await readFile(printJob.path);
    form.append("assets", new Blob([compositeBytes], { type: "image/jpeg" }), `composite-${printJob.id}.jpg`);

    const response = await fetch(`${serverUrl}/api/sync/sessions`, {
      method: "POST",
      headers: deviceToken ? { "x-snapore-device-token": deviceToken } : undefined,
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
      throw new Error(failure?.detail ?? failure?.error ?? `Server sync merespons ${response.status}`);
    }
    const result = await response.json() as { galleryUrl?: string };
    job.status = "SYNCED";
    job.galleryUrl = result.galleryUrl;
    job.lastError = undefined;
    job.nextRetryAt = undefined;
  } catch (error) {
    job.status = "RETRYING";
    job.lastError = error instanceof Error ? error.message : "Unknown upload error";
    const delaySeconds = Math.min(300, 2 ** Math.min(job.attempts, 8)) + Math.random() * 3;
    job.nextRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  }
  job.updatedAt = new Date().toISOString();
  await saveState(state);
}

const server = createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { error: "Device token tidak valid" });
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      const disk = await statfs(dataRoot).catch(() => null);
      const discovered = await printer.discover();
      const sdkCameras = await discoverSdkCameras();
      const state = await loadState();
      const connection = await ensurePrinterConnected({ respectAutoConnect: true }).catch(async (error) => ({
        device: undefined,
        config: state.printerConfig,
        health: { status: "OFFLINE" as const, message: error instanceof Error ? error.message : "Auto-connect gagal", checkedAt: new Date().toISOString() },
      }));
      const consumables = connection.device ? await printer.getConsumables?.().catch(() => undefined) : undefined;
      json(res, 200, {
        version: "0.2.0",
        boothCode,
        storage: { root: dataRoot, freeBytes: disk ? disk.bavail * disk.bsize : undefined },
        devices: [
          { id: "browser-camera", type: "CAMERA", name: "Browser camera", status: "ONLINE" },
          ...sdkCameras.map(({ device }) => device),
          ...discovered,
        ],
        printerBridge: {
          configured: connection.config ?? null,
          connectedDeviceId: connection.device?.id ?? null,
          connectedDeviceName: connection.device?.name ?? null,
          health: connection.health,
          sdk: {
            dnp: Boolean(process.env.SNAPORE_DNP_SDK_BRIDGE),
            epson: Boolean(process.env.SNAPORE_EPSON_SDK_BRIDGE),
          },
          paper: consumables ? { remaining: consumables.paperRemaining, capacity: consumables.paperCapacity, source: consumables.source } : null,
        },
      });
      return;
    }

    if (req.method === "POST" && req.url === "/printer/configure") {
      const input = await readJson<PrinterBridgeConfig>(req);
      if (!input.deviceId || !input.queueName || !input.kind) throw new Error("Device, queue, dan jenis printer wajib dipilih");
      if (!Number.isFinite(input.dpi) || input.dpi < 150 || input.dpi > 1200) throw new Error("DPI printer tidak valid");
      const devices = await printer.discover();
      const selected = devices.find((device) => device.id === input.deviceId || device.name === input.queueName);
      if (!selected) throw new Error("Queue printer yang dipilih tidak ditemukan di Windows");
      const config: PrinterBridgeConfig = {
        deviceId: selected.id,
        queueName: selected.name,
        kind: selected.kind,
        autoConnect: input.autoConnect !== false,
        mediaName: input.mediaName || "4x6",
        dpi: Math.floor(input.dpi),
        borderless: input.borderless !== false,
        dnpCutQueueName: input.dnpCutQueueName?.trim() || undefined,
      };
      const state = await loadState();
      state.printerConfig = config;
      await saveState(state);
      if (config.autoConnect) await printer.connect(selected.id);
      const health = await printer.getHealth();
      json(res, 200, { ok: true, config, device: selected, health });
      return;
    }

    if (req.method === "GET" && req.url === "/cameras") {
      const discovered = await discoverSdkCameras();
      json(res, 200, { cameras: discovered.map(({ device }) => device) });
      return;
    }

    if (req.method === "POST" && req.url === "/camera/capture") {
      const input = await readJson<{ deviceId?: string }>(req);
      const discovered = await discoverSdkCameras();
      const selected = input.deviceId
        ? discovered.find(({ device }) => device.id === input.deviceId)
        : discovered[0];
      if (!selected) {
        json(res, 404, { error: "Kamera SDK tidak ditemukan" });
        return;
      }
      await selected.adapter.connect(selected.device.id);
      const capture = await selected.adapter.capture();
      res.statusCode = 200;
      res.setHeader("content-type", capture.mimeType);
      res.setHeader("x-snapore-camera-id", selected.device.id);
      res.end(capture.bytes);
      return;
    }

    if (req.method === "GET" && req.url === "/jobs") {
      const state = await loadState();
      json(res, 200, { printJobs: state.printJobs.slice(-20), uploadJobs: state.uploadJobs.slice(-20) });
      return;
    }

    if (req.method === "POST" && req.url === "/captures") {
      const input = await readJson<{ id: string; sessionId: string; slotIndex: number; dataUrl: string }>(req);
      const id = safeSegment(input.id);
      const sessionId = safeSegment(input.sessionId);
      const image = parseDataUrl(input.dataUrl);
      const checksum = hash(image.bytes);
      const destination = join(sessionDirectory(sessionId), "originals", `${id}${extensionFor(image.mimeType)}`);
      await atomicWrite(destination, image.bytes);
      const state = await loadState();
      const slotIndex = Math.max(0, Math.floor(input.slotIndex));
      const previousRevisions = state.captures.filter(
        (capture) => capture.sessionId === sessionId && capture.slotIndex === slotIndex,
      );
      previousRevisions.forEach((capture) => { capture.active = false; });
      const record: CaptureRecord = {
        id,
        sessionId,
        slotIndex,
        path: destination,
        checksum,
        mimeType: image.mimeType,
        active: true,
        revision: Math.max(0, ...previousRevisions.map((capture) => capture.revision ?? 1)) + 1,
        createdAt: new Date().toISOString(),
      };
      const existing = state.captures.findIndex((capture) => capture.id === id);
      if (existing >= 0) state.captures[existing] = record;
      else state.captures.push(record);
      await saveState(state);
      json(res, 201, { id, path: destination, checksum });
      return;
    }

    if (req.method === "POST" && req.url === "/sessions/reset") {
      const input = await readJson<{ sessionId: string }>(req);
      const sessionId = safeSegment(input.sessionId);
      const state = await loadState();
      let deactivatedCaptures = 0;
      state.captures.forEach((capture) => {
        if (capture.sessionId === sessionId && capture.active !== false) {
          capture.active = false;
          deactivatedCaptures += 1;
        }
      });
      await saveState(state);
      json(res, 200, { sessionId, deactivatedCaptures });
      return;
    }

    if (req.method === "POST" && req.url === "/jobs/print") {
      const input = await readJson<{
        sessionId: string;
        compositeDataUrl: string;
        copies: number;
        layoutId: string;
        frameId: string;
        printJobId: string;
        uploadJobId: string;
        dnpTwoInchCut?: boolean;
      }>(req);
      const sessionId = safeSegment(input.sessionId);
      const printJobId = safeSegment(input.printJobId);
      const uploadJobId = safeSegment(input.uploadJobId);
      const image = parseDataUrl(input.compositeDataUrl);
      const destination = join(sessionDirectory(sessionId), "composites", `print-${printJobId}${extensionFor(image.mimeType)}`);
      await atomicWrite(destination, image.bytes);
      const state = await loadState();
      const now = new Date().toISOString();
      let printJob = state.printJobs.find((job) => job.id === printJobId);
      if (!printJob) {
        printJob = {
          id: printJobId,
          sessionId,
          path: destination,
          copies: Math.max(1, Math.min(10, Math.floor(input.copies))),
          status: "QUEUED",
          profile: {
            mediaName: "4x6",
            dpi: 300,
            orientation: "portrait",
            borderless: true,
            photoPaper: true,
            dnpTwoInchCut: input.dnpTwoInchCut === true,
          },
          createdAt: now,
          updatedAt: now,
        };
        state.printJobs.push(printJob);
      }
      let uploadJob = state.uploadJobs.find((job) => job.id === uploadJobId);
      if (!uploadJob) {
        uploadJob = {
          id: uploadJobId,
          sessionId,
          status: "QUEUED",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        };
        state.uploadJobs.push(uploadJob);
      }
      await atomicWrite(
        join(sessionDirectory(sessionId), "manifest.json"),
        Buffer.from(JSON.stringify({ schemaVersion: 2, sessionId, layoutId: input.layoutId, frameId: input.frameId, dnpTwoInchCut: input.dnpTwoInchCut === true, printJob, uploadJob }, null, 2)),
      );
      await saveState(state);
      void (async () => {
        await processPrintJob(printJobId);
        await processUploadQueue();
      })();
      json(res, 202, { printJobId, uploadJobId, localPath: destination, printStatus: printJob.status, uploadStatus: uploadJob.status });
      return;
    }

    json(res, 404, { error: "Endpoint tidak ditemukan" });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : "Request gagal" });
  }
});

async function start() {
  await ensureRoot();
  setInterval(() => void processUploadQueue(), 10_000).unref();
  setInterval(() => void ensurePrinterConnected({ respectAutoConnect: true }).catch(() => undefined), 5_000).unref();
  void ensurePrinterConnected({ respectAutoConnect: true }).catch(() => undefined);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Snapore device agent listening on http://127.0.0.1:${port}`);
    console.log(`Local photo directory: ${dataRoot}`);
  });
}

void start();
