import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { MockPrinterAdapter, OsSpoolerPrinterAdapter } from "./adapters";
import type { PrinterAdapter } from "./contracts";

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
    return JSON.parse(await readFile(statePath, "utf8")) as AgentState;
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

const printer: PrinterAdapter = process.env.SNAPORE_PRINTER_MODE === "os-spooler"
  ? new OsSpoolerPrinterAdapter()
  : new MockPrinterAdapter();

async function processPrintJob(jobId: string) {
  const state = await loadState();
  const job = state.printJobs.find((candidate) => candidate.id === jobId);
  if (!job || job.status !== "QUEUED") return;
  job.status = "PRINTING";
  job.updatedAt = new Date().toISOString();
  await saveState(state);

  try {
    const devices = await printer.discover();
    if (!devices[0]) throw new Error("Tidak ada printer kompatibel yang ditemukan");
    await printer.connect(devices[0].id);
    const result = await printer.print({
      jobId: job.id,
      filePath: job.path,
      copies: job.copies,
      profile: { mediaName: "4x6", dpi: 300, orientation: "portrait", borderless: true },
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
      json(res, 200, {
        version: "0.1.0",
        boothCode,
        storage: { root: dataRoot, freeBytes: disk ? disk.bavail * disk.bsize : undefined },
        devices: [
          { id: "browser-camera", type: "CAMERA", name: "Browser camera", status: "ONLINE" },
          ...discovered,
        ],
      });
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
        Buffer.from(JSON.stringify({ schemaVersion: 1, sessionId, layoutId: input.layoutId, frameId: input.frameId, printJob, uploadJob }, null, 2)),
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
  server.listen(port, "127.0.0.1", () => {
    console.log(`Snapore device agent listening on http://127.0.0.1:${port}`);
    console.log(`Local photo directory: ${dataRoot}`);
  });
}

void start();
