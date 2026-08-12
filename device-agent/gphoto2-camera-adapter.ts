import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { CameraAdapter, DeviceHealth, DiscoveredDevice } from "./contracts";

const execFileAsync = promisify(execFile);

export type Gphoto2Mode = "native" | "wsl";

type Gphoto2CameraAdapterOptions = {
  mode?: Gphoto2Mode;
  executable?: string;
  wslDistro?: string;
  imageFormat?: string;
  usbipdAutoAttach?: boolean;
};

export type Gphoto2DetectedCamera = {
  name: string;
  port: string;
};

export type UsbipdCanonDevice = {
  busId: string;
  state: "ATTACHED" | "SHARED" | "NOT_SHARED" | "UNKNOWN";
};

export function parseGphoto2AutoDetect(output: string): Gphoto2DetectedCamera[] {
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^model\s+port$/i.test(line) && !/^-+$/.test(line))
    .map((line) => /^(.*?)\s{2,}((?:usb|ptpip|serial):\S+)$/i.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ name: match[1].trim(), port: match[2].trim() }));

  return devices.filter((device, index) => devices.findIndex((candidate) => candidate.port === device.port) === index);
}

export function parseGphoto2SummaryModel(output: string) {
  return /^Model:\s*(.+)$/im.exec(output)?.[1]?.trim() || undefined;
}

export function windowsPathToWslPath(path: string) {
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(path);
  if (!match) return path.replaceAll("\\", "/");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

export function parseUsbipdCanonR100(output: string): UsbipdCanonDevice | undefined {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => /04a9:3312|canon\s+eos\s+r100/i.test(candidate));
  if (!line) return undefined;
  const busId = /^\s*(\d+-\d+)\s+/.exec(line)?.[1];
  if (!busId) return undefined;
  const state = /not\s+shared/i.test(line)
    ? "NOT_SHARED"
    : /attached/i.test(line)
      ? "ATTACHED"
      : /shared/i.test(line)
        ? "SHARED"
        : "UNKNOWN";
  return { busId, state };
}

function commandFailure(error: unknown, mode: Gphoto2Mode) {
  const details = error && typeof error === "object"
    ? ["stderr", "stdout", "message"]
      .map((key) => key in error ? String((error as Record<string, unknown>)[key] ?? "").trim() : "")
      .find(Boolean)
    : "";
  const prefix = mode === "wsl"
    ? "gPhoto2/PTP di WSL gagal. Pastikan WSL, gphoto2, dan USB R100 sudah di-attach melalui usbipd"
    : "gPhoto2/PTP gagal. Pastikan executable gphoto2 tersedia";
  return new Error(details ? `${prefix}: ${details}` : prefix);
}

function captureMimeType(path: string) {
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.png$/i.test(path) ? "image/png" : undefined;
}

export function isGphoto2OutputForPrefix(name: string, prefixName: string) {
  return name.startsWith(`${prefixName}.`) || name.startsWith(`thumb_${prefixName}.`);
}

export function parseGphoto2CaptureChoices(output: string) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /^Capture choices\s*:/i.test(line));
  if (start < 0) return { image: false, preview: false };
  const choices: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+:\s*(.+?)\s*$/.exec(line);
    if (!match) break;
    choices.push(match[1].toLowerCase());
  }
  return {
    image: choices.includes("image"),
    preview: choices.includes("preview"),
  };
}

export function extractJpegFrames(input: Buffer) {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < input.length) {
    const start = input.indexOf(Buffer.from([0xff, 0xd8, 0xff]), offset);
    if (start < 0) {
      return { frames, remainder: input.subarray(Math.max(offset, input.length - 2)) };
    }
    const end = input.indexOf(Buffer.from([0xff, 0xd9]), start + 3);
    if (end < 0) return { frames, remainder: input.subarray(start) };
    frames.push(Buffer.from(input.subarray(start, end + 2)));
    offset = end + 2;
  }
  return { frames, remainder: Buffer.alloc(0) };
}

async function captureFiles(prefix: string) {
  const prefixName = basename(prefix);
  return (await readdir(tmpdir()))
    .filter((name) => isGphoto2OutputForPrefix(name, prefixName))
    .map((name) => join(tmpdir(), name));
}

export class Gphoto2CameraAdapter implements CameraAdapter {
  readonly kind = "GPHOTO2_PTP";
  private readonly mode: Gphoto2Mode;
  private readonly executable: string;
  private readonly wslDistro?: string;
  private readonly imageFormat?: string;
  private readonly usbipdAutoAttach: boolean;
  private readonly deviceNames = new Map<string, string>();
  private connectedPort: string | null = null;
  private connectedName: string | null = null;
  private connectedCaptureChoices: { image: boolean; preview: boolean } | null = null;
  private previewProcess: ReturnType<typeof spawn> | null = null;
  private previewBuffer: Buffer = Buffer.alloc(0);
  private previewFrame: Buffer | null = null;
  private previewStreamError: Error | null = null;
  private previewIdleTimer: NodeJS.Timeout | null = null;
  private previewStreamDisabled = false;
  private previewLinuxPid: number | null = null;

  constructor(options: Gphoto2CameraAdapterOptions = {}) {
    this.mode = options.mode ?? (process.platform === "win32" ? "wsl" : "native");
    this.executable = options.executable?.trim() || "gphoto2";
    this.wslDistro = options.wslDistro?.trim() || undefined;
    this.imageFormat = options.imageFormat?.trim() || undefined;
    this.usbipdAutoAttach = options.usbipdAutoAttach !== false;
  }

  private command(args: string[]) {
    if (this.mode === "native") return { executable: this.executable, args };
    return {
      executable: "wsl.exe",
      args: [
        ...(this.wslDistro ? ["--distribution", this.wslDistro] : []),
        "--exec",
        this.executable,
        ...args,
      ],
    };
  }

  private async run(args: string[], timeout = 30_000) {
    const command = this.command(args);
    try {
      const { stdout } = await execFileAsync(command.executable, command.args, {
        timeout,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout.trim();
    } catch (error) {
      throw commandFailure(error, this.mode);
    }
  }

  private previewIdleMs() {
    const configured = Number(process.env.SNAPORE_CAMERA_PREVIEW_IDLE_MS ?? 1_500);
    return Number.isFinite(configured) ? Math.min(10_000, Math.max(500, configured)) : 1_500;
  }

  private schedulePreviewStop() {
    if (this.previewIdleTimer) clearTimeout(this.previewIdleTimer);
    this.previewIdleTimer = setTimeout(() => void this.stopPreviewStream(), this.previewIdleMs());
    this.previewIdleTimer.unref();
  }

  private startPreviewStream() {
    if (!this.connectedPort) throw new Error("Kamera PTP belum terhubung");
    if (this.previewProcess) return;
    const previewArgs = ["--port", this.connectedPort, "--capture-movie", "--stdout"];
    const command = this.mode === "wsl"
      ? {
        executable: "wsl.exe",
        args: [
          ...(this.wslDistro ? ["--distribution", this.wslDistro] : []),
          "--exec",
          "sh",
          "-c",
          "echo SNAPORE_PREVIEW_PID=$$ >&2; exec \"$@\"",
          "snapore-preview",
          this.executable,
          ...previewArgs,
        ],
      }
      : this.command(previewArgs);
    const child = spawn(command.executable, command.args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.previewProcess = child;
    this.previewBuffer = Buffer.alloc(0);
    this.previewFrame = null;
    this.previewStreamError = null;
    this.previewLinuxPid = null;
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      if (this.previewProcess !== child) return;
      const parsed = extractJpegFrames(Buffer.concat([this.previewBuffer, chunk]));
      this.previewBuffer = parsed.remainder;
      const newest = parsed.frames.at(-1);
      if (newest && newest.length > 4_096) this.previewFrame = newest;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
      const pid = /SNAPORE_PREVIEW_PID=(\d+)/.exec(stderr)?.[1];
      if (pid) this.previewLinuxPid = Number(pid);
    });
    child.once("error", (error) => {
      if (this.previewProcess === child) this.previewStreamError = commandFailure(error, this.mode);
    });
    child.once("close", (code) => {
      if (this.previewProcess !== child) return;
      this.previewProcess = null;
      this.previewBuffer = Buffer.alloc(0);
      this.previewFrame = null;
      this.previewLinuxPid = null;
      if (!this.previewStreamError && code !== 0) {
        this.previewStreamError = new Error(stderr.trim() || `gPhoto2 preview stream berhenti (${code ?? "unknown"})`);
      }
    });
  }

  private async waitForPreviewFrame(timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.previewFrame) return this.previewFrame;
      if (this.previewStreamError) throw this.previewStreamError;
      await delay(20);
    }
    throw new Error("Frame preview Canon belum tersedia");
  }

  private async stopPreviewStream() {
    if (this.previewIdleTimer) clearTimeout(this.previewIdleTimer);
    this.previewIdleTimer = null;
    const child = this.previewProcess;
    if (!child) return;
    const linuxPid = this.previewLinuxPid;
    this.previewProcess = null;
    this.previewBuffer = Buffer.alloc(0);
    this.previewFrame = null;
    this.previewLinuxPid = null;
    let closed = false;
    const closedPromise = new Promise<void>((resolve) => child.once("close", () => { closed = true; resolve(); }));
    if (this.mode === "wsl" && linuxPid) {
      const signal = async (name: "INT" | "TERM") => {
        await execFileAsync("wsl.exe", [
          ...(this.wslDistro ? ["--distribution", this.wslDistro] : []),
          "--exec",
          "kill",
          `-${name}`,
          String(linuxPid),
        ], { timeout: 2_000, windowsHide: true }).catch(() => undefined);
      };
      await signal("INT");
      await Promise.race([closedPromise, delay(1_000)]);
      if (!closed) await signal("TERM");
    } else {
      child.kill("SIGINT");
    }
    if (!closed) await Promise.race([closedPromise, delay(1_000)]);
    if (!closed) child.kill("SIGKILL");
    await delay(200);
  }

  private normalizeDeviceId(deviceId: string) {
    return deviceId.startsWith(`${this.kind}:`) ? deviceId.slice(this.kind.length + 1) : deviceId;
  }

  private async ensureCanonUsbAttached() {
    if (this.mode !== "wsl" || !this.usbipdAutoAttach) return false;
    let output: string;
    try {
      const result = await execFileAsync("usbipd.exe", ["list"], { timeout: 5_000, windowsHide: true });
      output = result.stdout;
    } catch {
      throw new Error("usbipd belum terpasang. Pasang dengan: winget install usbipd");
    }
    const camera = parseUsbipdCanonR100(output);
    if (!camera) return false;
    if (camera.state === "NOT_SHARED") {
      throw new Error(`Canon EOS R100 ditemukan pada BUSID ${camera.busId}, tetapi belum dibind. Jalankan PowerShell Administrator: usbipd bind --busid ${camera.busId}`);
    }
    if (camera.state === "SHARED") {
      const args = ["attach", "--wsl", "--busid", camera.busId];
      try {
        await execFileAsync("usbipd.exe", args, { timeout: 15_000, windowsHide: true });
      } catch (error) {
        const message = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
        throw new Error(message ? `Auto-attach R100 gagal: ${message}` : "Auto-attach R100 ke WSL gagal");
      }
      await delay(1_200);
    }
    return camera.state === "ATTACHED" || camera.state === "SHARED";
  }

  async discover(): Promise<DiscoveredDevice[]> {
    if (this.previewProcess && this.connectedPort) {
      return [{
        id: `${this.kind}:${this.connectedPort}`,
        fingerprint: `gphoto2:${this.connectedPort}`,
        type: "CAMERA",
        kind: this.kind,
        name: this.connectedName ?? "PTP camera",
        status: "ONLINE",
        capabilities: {
          ptp: true,
          gphoto2: true,
          sdkBridge: false,
          transport: this.connectedPort.split(":", 1)[0]?.toUpperCase() ?? "PTP",
          driverName: `libgphoto2/PTP (${this.mode})`,
          usbipdAutoAttach: this.mode === "wsl" && this.usbipdAutoAttach,
        },
      }];
    }
    let devices = parseGphoto2AutoDetect(await this.run(["--auto-detect"], 8_000));
    if (!devices.some((device) => /eos\s+r100/i.test(device.name))) {
      const attached = await this.ensureCanonUsbAttached();
      if (attached) devices = parseGphoto2AutoDetect(await this.run(["--auto-detect"], 8_000));
    }
    const resolvedDevices = await Promise.all(devices.map(async (device) => {
      if (!/^usb\s+ptp\s+class\s+camera$/i.test(device.name)) return device;
      const cachedName = this.deviceNames.get(device.port);
      if (cachedName) return { ...device, name: cachedName };
      const summary = await this.run(["--port", device.port, "--summary"], 10_000).catch(() => "");
      const model = parseGphoto2SummaryModel(summary);
      if (model) this.deviceNames.set(device.port, model);
      return model ? { ...device, name: model } : device;
    }));
    return resolvedDevices.map((device) => ({
      id: `${this.kind}:${device.port}`,
      fingerprint: `gphoto2:${device.port}`,
      type: "CAMERA",
      kind: this.kind,
      name: device.name,
      status: "ONLINE",
      capabilities: {
        ptp: true,
        gphoto2: true,
        sdkBridge: false,
        transport: device.port.split(":", 1)[0]?.toUpperCase() ?? "PTP",
        driverName: `libgphoto2/PTP (${this.mode})`,
        usbipdAutoAttach: this.mode === "wsl" && this.usbipdAutoAttach,
      },
    }));
  }

  async connect(deviceId: string) {
    const port = this.normalizeDeviceId(deviceId);
    if (this.connectedPort === port) return;
    const devices = parseGphoto2AutoDetect(await this.run(["--auto-detect"], 8_000));
    const selected = devices.find((device) => device.port === port);
    if (!selected) throw new Error(`Kamera PTP ${port} tidak ditemukan`);
    const summary = await this.run(["--port", port, "--summary"], 10_000);
    const model = parseGphoto2SummaryModel(summary);
    if (model) this.deviceNames.set(port, model);
    this.connectedPort = port;
    this.connectedName = model ?? this.deviceNames.get(port) ?? selected.name;
    this.connectedCaptureChoices = null;
    this.previewStreamDisabled = false;
  }

  async disconnect() {
    await this.stopPreviewStream();
    this.connectedPort = null;
    this.connectedName = null;
    this.connectedCaptureChoices = null;
    this.previewStreamDisabled = false;
  }

  async getCapabilities() {
    if (!this.connectedPort) return { ptp: true, gphoto2: true, connected: false };
    if (!this.connectedCaptureChoices) {
      const abilities = await this.run(["--port", this.connectedPort, "--abilities"], 10_000);
      this.connectedCaptureChoices = parseGphoto2CaptureChoices(abilities);
    }
    return {
      ptp: true,
      gphoto2: true,
      connected: true,
      captureImage: this.connectedCaptureChoices.image,
      capturePreview: this.connectedCaptureChoices.preview,
      downloadAfterCapture: true,
      cameraName: this.connectedName,
      driverName: `libgphoto2/PTP (${this.mode})`,
    };
  }

  async preview() {
    if (!this.connectedPort) throw new Error("Kamera PTP belum terhubung");
    const configuredTimeout = Number(process.env.SNAPORE_CAMERA_PREVIEW_TIMEOUT_MS ?? 15_000);
    const timeout = Number.isFinite(configuredTimeout) ? Math.min(30_000, Math.max(5_000, configuredTimeout)) : 15_000;
    if (process.env.SNAPORE_CAMERA_PREVIEW_STREAM !== "false" && !this.previewStreamDisabled) {
      try {
        this.startPreviewStream();
        const frame = this.previewFrame ?? await this.waitForPreviewFrame(Math.min(timeout, 5_000));
        this.schedulePreviewStop();
        return { bytes: frame, mimeType: "image/jpeg" };
      } catch {
        this.previewStreamDisabled = true;
        await this.stopPreviewStream();
      }
    }

    const prefix = join(tmpdir(), `snapore-gphoto2-preview-${randomUUID()}`);
    const commandPrefix = this.mode === "wsl" ? windowsPathToWslPath(prefix) : prefix;
    let createdFiles: string[] = [];
    try {
      await this.run([
        "--port", this.connectedPort,
        "--capture-preview",
        // Canon preview frames can report the internal name `capture_preview`
        // without an extension, which makes gPhoto2 reject the `%C` template.
        // `--capture-preview` returns JPEG for the supported PTP cameras here,
        // so use an explicit extension and let captureFiles also accept the
        // `thumb_` prefix that gPhoto2 may add.
        "--filename", `${commandPrefix}.jpg`,
        "--force-overwrite",
      ], timeout);
      createdFiles = await captureFiles(prefix);
      const output = createdFiles.find((path) => captureMimeType(path));
      if (!output) throw new Error("gPhoto2 tidak menghasilkan frame preview yang dapat dibaca");
      const bytes = await readFile(output);
      if (bytes.length === 0) throw new Error("gPhoto2 menghasilkan frame preview kosong");
      return { bytes, mimeType: captureMimeType(output) ?? "image/jpeg" };
    } finally {
      if (createdFiles.length === 0) createdFiles = await captureFiles(prefix).catch(() => []);
      await Promise.all(createdFiles.map((path) => unlink(path).catch(() => undefined)));
    }
  }

  async capture() {
    if (!this.connectedPort) throw new Error("Kamera PTP belum terhubung");
    await this.stopPreviewStream();
    const prefix = join(tmpdir(), `snapore-gphoto2-${randomUUID()}`);
    const commandPrefix = this.mode === "wsl" ? windowsPathToWslPath(prefix) : prefix;
    const configuredTimeout = Number(process.env.SNAPORE_CAMERA_CAPTURE_TIMEOUT_MS ?? 45_000);
    const timeout = Number.isFinite(configuredTimeout) ? Math.min(120_000, Math.max(10_000, configuredTimeout)) : 45_000;
    const args = ["--port", this.connectedPort];
    if (this.imageFormat) args.push("--set-config", `imageformat=${this.imageFormat}`);
    args.push("--capture-image-and-download", "--filename", `${commandPrefix}.%C`, "--force-overwrite");

    let createdFiles: string[] = [];
    try {
      await this.run(args, timeout);
      createdFiles = await captureFiles(prefix);
      const output = createdFiles.find((path) => captureMimeType(path));
      if (!output) {
        const raw = createdFiles.find((path) => /\.(cr2|cr3|raw)$/i.test(path));
        if (raw) throw new Error("R100 menghasilkan RAW saja. Ubah Image quality kamera ke JPEG atau isi SNAPORE_GPHOTO2_IMAGE_FORMAT");
        throw new Error("gPhoto2 tidak menghasilkan file foto yang dapat dibaca");
      }
      const bytes = await readFile(output);
      if (bytes.length === 0) throw new Error("gPhoto2 menghasilkan file foto kosong");
      return { bytes, mimeType: captureMimeType(output) ?? "image/jpeg" };
    } finally {
      if (createdFiles.length === 0) createdFiles = await captureFiles(prefix).catch(() => []);
      await Promise.all(createdFiles.map((path) => unlink(path).catch(() => undefined)));
    }
  }

  async getHealth(): Promise<DeviceHealth> {
    return {
      status: this.connectedPort ? "ONLINE" : "OFFLINE",
      message: this.connectedPort ? `${this.connectedName ?? "Kamera"} connected via gPhoto2/PTP` : "gPhoto2/PTP ready",
      checkedAt: new Date().toISOString(),
    };
  }
}
