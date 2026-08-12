import { execFile } from "node:child_process";
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

async function captureFiles(prefix: string) {
  const prefixName = basename(prefix);
  return (await readdir(tmpdir()))
    .filter((name) => name.startsWith(`${prefixName}.`))
    .map((name) => join(tmpdir(), name));
}

export class Gphoto2CameraAdapter implements CameraAdapter {
  readonly kind = "GPHOTO2_PTP";
  private readonly mode: Gphoto2Mode;
  private readonly executable: string;
  private readonly wslDistro?: string;
  private readonly imageFormat?: string;
  private readonly usbipdAutoAttach: boolean;
  private connectedPort: string | null = null;
  private connectedName: string | null = null;

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
    let devices = parseGphoto2AutoDetect(await this.run(["--auto-detect"], 8_000));
    if (!devices.some((device) => /eos\s+r100/i.test(device.name))) {
      const attached = await this.ensureCanonUsbAttached();
      if (attached) devices = parseGphoto2AutoDetect(await this.run(["--auto-detect"], 8_000));
    }
    return devices.map((device) => ({
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
    await this.run(["--port", port, "--summary"], 10_000);
    this.connectedPort = port;
    this.connectedName = selected.name;
  }

  async disconnect() {
    this.connectedPort = null;
    this.connectedName = null;
  }

  async getCapabilities() {
    if (!this.connectedPort) return { ptp: true, gphoto2: true, connected: false };
    const abilities = await this.run(["--port", this.connectedPort, "--abilities"], 10_000);
    return {
      ptp: true,
      gphoto2: true,
      connected: true,
      captureImage: /capture image|image capture/i.test(abilities),
      downloadAfterCapture: true,
      cameraName: this.connectedName,
      driverName: `libgphoto2/PTP (${this.mode})`,
    };
  }

  async capture() {
    if (!this.connectedPort) throw new Error("Kamera PTP belum terhubung");
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
