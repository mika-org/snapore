import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { DiscoveredDevice, PrinterAdapter, PrintRequest } from "./contracts";

const execFileAsync = promisify(execFile);
const powershellPath = process.env.SNAPORE_POWERSHELL_PATH || "powershell.exe";
const windowsBridgeScript = resolve(process.cwd(), "device-agent", "windows-printer.ps1");

type WindowsPrinter = {
  Name?: string;
  DriverName?: string;
  PortName?: string;
  PrinterStatus?: string | number | null;
  WorkOffline?: boolean | string | null;
  Type?: string | number | null;
};

type ConnectedPrinter = DiscoveredDevice & {
  queueName: string;
  driverName: string;
};

function printerKind(name: string, driverName: string) {
  const value = `${name} ${driverName}`.toUpperCase();
  if (/\bDNP\b|DS[- ]?RX1|RX1HS|DS620|DS820|DS40|DS80/.test(value)) return "DNP";
  if (/EPSON/.test(value)) return "EPSON";
  if (/POS[- ]?\d|THERMAL|RECEIPT|ESC[\/-]?POS/.test(value)) return "ESC_POS";
  return "OS_SPOOLER";
}

function isVirtualPrinter(name: string, driverName: string) {
  return /PDF|ONENOTE|XPS|FAX|DOCUMENT WRITER/.test(`${name} ${driverName}`.toUpperCase());
}

function capabilitiesFor(kind: string, name: string, driverName: string) {
  const dnpRx = /DS[- ]?RX1|RX1HS/.test(`${name} ${driverName}`.toUpperCase());
  if (kind === "DNP") {
    return {
      photoPrinter: true,
      media: ["4x6", "5x7", "6x8"],
      dpi: [300],
      borderless: true,
      twoInchCut: dnpRx,
      twoInchCutMedia: dnpRx ? ["4x6"] : [],
      cutRouting: "SDK_OR_DEDICATED_WINDOWS_QUEUE",
      driverName,
    };
  }
  if (kind === "EPSON") {
    return {
      photoPrinter: true,
      media: ["4x6", "A6", "A5", "A4"],
      dpi: [300, 600],
      borderless: true,
      photoPaper: true,
      paperTypeManagedByDriver: true,
      driverName,
    };
  }
  return {
    photoPrinter: kind !== "ESC_POS",
    requiresDriver: true,
    paperTypeManagedByDriver: true,
    driverName,
  };
}

function deviceStatus(printer: WindowsPrinter) {
  const offline = printer.WorkOffline === true || String(printer.WorkOffline).toLowerCase() === "true";
  const status = String(printer.PrinterStatus ?? "").toUpperCase();
  if (offline || /OFFLINE|ERROR|PAPERJAM|PAPEROUT|NOTAVAILABLE/.test(status)) return "OFFLINE" as const;
  if (/DEGRADED|BUSY|WARMING|INITIALIZING/.test(status)) return "DEGRADED" as const;
  return "ONLINE" as const;
}

function fingerprint(queueName: string) {
  return `windows-printer:${Buffer.from(queueName, "utf8").toString("base64url")}`;
}

async function runWindowsBridge(args: string[], timeout = 30_000) {
  if (!existsSync(windowsBridgeScript)) throw new Error(`Windows printer bridge tidak ditemukan: ${windowsBridgeScript}`);
  return execFileAsync(
    powershellPath,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", windowsBridgeScript, ...args],
    { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
  );
}

async function runVendorBridge(executable: string, args: string[], timeout = 120_000) {
  if (!existsSync(executable)) throw new Error(`Executable bridge vendor tidak ditemukan: ${executable}`);
  return execFileAsync(executable, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
}

export class MockPrinterAdapter implements PrinterAdapter {
  readonly kind = "MOCK";
  private connected = false;

  async discover(): Promise<DiscoveredDevice[]> {
    return [{ id: "mock-dnp-rx1", fingerprint: "mock:dnp:rx1:001", type: "PRINTER", kind: this.kind, name: "DNP DS-RX1 (simulator)", status: "ONLINE", capabilities: { media: ["4x6", "6x8"], dpi: [300], maxCopies: 10 } }];
  }

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }
  async getCapabilities() { return { media: ["4x6", "6x8"], dpi: [300], borderless: true }; }
  async getHealth() { return { status: this.connected ? "ONLINE" as const : "OFFLINE" as const, checkedAt: new Date().toISOString() }; }
  async print(request: PrintRequest) {
    if (!this.connected) throw new Error("Printer simulator belum terhubung");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
    return { spoolerId: `mock-spool-${request.jobId}`, status: "PRINTED" as const };
  }
  async cancel() { return true; }
}

export class OsSpoolerPrinterAdapter implements PrinterAdapter {
  readonly kind = "OS_SPOOLER";
  private connected: ConnectedPrinter | null = null;
  private discoveryCache: { at: number; devices: DiscoveredDevice[] } | null = null;
  private discoveryInFlight: Promise<DiscoveredDevice[]> | null = null;

  async discover(): Promise<DiscoveredDevice[]> {
    if (this.discoveryCache && Date.now() - this.discoveryCache.at < 4_000) return this.discoveryCache.devices;
    if (this.discoveryInFlight) return this.discoveryInFlight;
    this.discoveryInFlight = this.discoverWindowsPrinters();
    try {
      const devices = await this.discoveryInFlight;
      this.discoveryCache = { at: Date.now(), devices };
      return devices;
    } finally {
      this.discoveryInFlight = null;
    }
  }

  private async discoverWindowsPrinters(): Promise<DiscoveredDevice[]> {
    if (process.platform !== "win32") return [];
    const { stdout } = await runWindowsBridge(["-Mode", "discover"]);
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout) as WindowsPrinter | WindowsPrinter[];
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((printer) => printer.Name && !isVirtualPrinter(printer.Name, printer.DriverName ?? ""))
      .map((printer) => {
        const name = String(printer.Name);
        const driverName = String(printer.DriverName ?? "Windows driver");
        const kind = printerKind(name, driverName);
        return {
          id: fingerprint(name),
          fingerprint: fingerprint(name),
          type: "PRINTER" as const,
          kind,
          name,
          status: deviceStatus(printer),
          capabilities: {
            ...capabilitiesFor(kind, name, driverName),
            queueName: name,
            portName: printer.PortName ?? null,
            sdkBridgeConfigured: kind === "DNP"
              ? Boolean(process.env.SNAPORE_DNP_SDK_BRIDGE)
              : kind === "EPSON"
                ? Boolean(process.env.SNAPORE_EPSON_SDK_BRIDGE)
                : false,
          },
        };
      });
  }

  async connect(deviceId: string) {
    const devices = await this.discover();
    const selected = devices.find((device) => device.id === deviceId || device.name === deviceId);
    if (!selected) throw new Error("Queue printer Windows tidak ditemukan");
    if (selected.status === "OFFLINE") throw new Error(`${selected.name} sedang offline`);
    this.connected = {
      ...selected,
      queueName: String(selected.capabilities.queueName ?? selected.name),
      driverName: String(selected.capabilities.driverName ?? "Windows driver"),
    };
  }

  async disconnect() { this.connected = null; }

  async getCapabilities() {
    return this.connected?.capabilities ?? { requiresDriver: true, supportedKinds: ["DNP", "EPSON", "OS_SPOOLER"] };
  }

  async getHealth() {
    if (!this.connected) return { status: "OFFLINE" as const, message: "Belum ada printer yang terhubung", checkedAt: new Date().toISOString() };
    const latest = (await this.discover()).find((device) => device.id === this.connected?.id);
    if (!latest) {
      this.connected = null;
      return { status: "OFFLINE" as const, message: "Queue printer tidak lagi tersedia", checkedAt: new Date().toISOString() };
    }
    return { status: latest.status, message: `${latest.name} · ${latest.kind}`, checkedAt: new Date().toISOString() };
  }

  async getConsumables() {
    if (!this.connected) return undefined;
    const executable = this.connected.kind === "DNP"
      ? process.env.SNAPORE_DNP_SDK_BRIDGE
      : this.connected.kind === "EPSON"
        ? process.env.SNAPORE_EPSON_SDK_BRIDGE
        : undefined;
    if (!executable) return undefined;
    try {
      const { stdout } = await runVendorBridge(executable, ["status", "--queue", this.connected.queueName, "--json"], 7_000);
      const status = JSON.parse(stdout) as { paperRemaining?: number; paperCapacity?: number };
      if (!Number.isInteger(status.paperRemaining) || !Number.isInteger(status.paperCapacity) || status.paperRemaining! < 0 || status.paperCapacity! < 1) return undefined;
      return { paperRemaining: status.paperRemaining!, paperCapacity: status.paperCapacity!, source: "SENSOR" as const };
    } catch {
      return undefined;
    }
  }

  async print(request: PrintRequest): Promise<{ spoolerId: string; status: "PRINTED" | "SPOOLING" }> {
    if (!this.connected) throw new Error("Printer belum terhubung");
    const kind = this.connected.kind;
    if (request.profile.dnpTwoInchCut && kind !== "DNP") {
      throw new Error("Frame meminta DNP 2-inch cut, tetapi printer terhubung bukan DNP");
    }
    if (request.profile.dnpTwoInchCut && this.connected.capabilities.twoInchCut !== true) {
      throw new Error(`${this.connected.name} tidak melaporkan dukungan DNP 2-inch cut`);
    }
    if (request.profile.dnpTwoInchCut && request.profile.mediaName !== "4x6") {
      throw new Error("DNP 2-inch cut pada DS-RX1/RX1HS hanya diizinkan untuk profil media 4x6");
    }

    const vendorBridge = kind === "DNP" ? process.env.SNAPORE_DNP_SDK_BRIDGE : kind === "EPSON" ? process.env.SNAPORE_EPSON_SDK_BRIDGE : undefined;
    if (vendorBridge) {
      const { stdout } = await runVendorBridge(vendorBridge, [
        "print",
        "--queue", this.connected.queueName,
        "--file", request.filePath,
        "--copies", String(request.copies),
        "--media", request.profile.mediaName,
        "--dpi", String(request.profile.dpi),
        "--borderless", String(request.profile.borderless),
        "--photo-paper", String(request.profile.photoPaper),
        "--two-inch-cut", String(request.profile.dnpTwoInchCut),
        "--job-id", request.jobId,
      ]);
      const response = stdout.trim() ? JSON.parse(stdout) as { spoolerId?: string; status?: "PRINTED" | "SPOOLING" } : {};
      return { spoolerId: response.spoolerId ?? `${kind.toLowerCase()}-${request.jobId}`, status: response.status ?? "SPOOLING" };
    }

    let queueName = request.profile.queueName || this.connected.queueName;
    if (request.profile.dnpTwoInchCut) {
      const cutQueue = request.profile.dnpCutQueueName || (/2\s*inch|2inch|cut/i.test(queueName) ? queueName : undefined);
      if (!cutQueue) {
        throw new Error("DNP 2-inch cut memerlukan SNAPORE_DNP_SDK_BRIDGE atau queue Windows khusus dengan driver 2inch cut aktif");
      }
      queueName = cutQueue;
    }

    await runWindowsBridge([
      "-Mode", "print",
      "-QueueName", queueName,
      "-FilePath", request.filePath,
      "-Copies", String(request.copies),
      "-MediaName", request.profile.mediaName,
      "-Orientation", request.profile.orientation,
      "-Borderless", String(request.profile.borderless),
    ], 120_000);
    return { spoolerId: `windows-${request.jobId}`, status: "SPOOLING" };
  }

  async cancel() { return false; }
}
