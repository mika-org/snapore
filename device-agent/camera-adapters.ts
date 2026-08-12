import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { CameraAdapter, DeviceHealth, DiscoveredDevice } from "./contracts";

const execFileAsync = promisify(execFile);

type BridgeDevice = {
  id: string;
  name: string;
  status?: DeviceHealth["status"];
  fingerprint?: string;
  capabilities?: Record<string, unknown>;
};

function bridgeDevices(output: string) {
  const payload = JSON.parse(output || "[]") as BridgeDevice[] | { devices?: BridgeDevice[] };
  const devices = Array.isArray(payload) ? payload : payload.devices;
  if (!Array.isArray(devices)) throw new Error("Bridge kamera mengembalikan format discovery yang tidak valid");
  return devices.filter((device) => typeof device?.id === "string" && device.id && typeof device.name === "string" && device.name);
}

export class SdkBridgeCameraAdapter implements CameraAdapter {
  private connectedDeviceId: string | null = null;

  constructor(readonly kind: string, private readonly executable: string) {}

  get activeDeviceId() {
    return this.connectedDeviceId ? `${this.kind}:${this.connectedDeviceId}` : null;
  }

  private async run(args: string[], timeout = 30_000) {
    const { stdout } = await execFileAsync(this.executable, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  }

  async discover(): Promise<DiscoveredDevice[]> {
    const output = await this.run(["discover", "--json"], 5_000);
    const devices = bridgeDevices(output);
    return devices.map((device) => ({
      id: `${this.kind}:${device.id}`,
      fingerprint: device.fingerprint ?? `${this.kind.toLowerCase()}:${device.id}`,
      type: "CAMERA",
      kind: this.kind,
      name: device.name,
      status: device.status ?? "ONLINE",
      capabilities: { sdkBridge: true, ...device.capabilities },
    }));
  }

  async connect(deviceId: string) {
    const normalizedId = deviceId.startsWith(`${this.kind}:`) ? deviceId.slice(this.kind.length + 1) : deviceId;
    if (this.connectedDeviceId === normalizedId) return;
    if (this.connectedDeviceId) await this.disconnect();
    await this.run(["connect", "--device", normalizedId], 6_000);
    this.connectedDeviceId = normalizedId;
  }

  async disconnect() {
    if (this.connectedDeviceId) await this.run(["disconnect", "--device", this.connectedDeviceId]).catch(() => undefined);
    this.connectedDeviceId = null;
  }

  async getCapabilities() {
    if (!this.connectedDeviceId) return { sdkBridge: true, connected: false };
    const output = await this.run(["capabilities", "--device", this.connectedDeviceId, "--json"], 5_000);
    return JSON.parse(output || "{}") as Record<string, unknown>;
  }

  async capture() {
    if (!this.connectedDeviceId) throw new Error("Kamera SDK belum terhubung");
    const output = join(tmpdir(), `snapore-${randomUUID()}.jpg`);
    const configuredTimeout = Number(process.env.SNAPORE_CAMERA_CAPTURE_TIMEOUT_MS ?? 45_000);
    const timeout = Number.isFinite(configuredTimeout) ? Math.min(120_000, Math.max(10_000, configuredTimeout)) : 45_000;
    await this.run(["capture", "--device", this.connectedDeviceId, "--output", output], timeout);
    try {
      const bytes = await readFile(output);
      if (bytes.length === 0) throw new Error("Bridge Canon menghasilkan file foto kosong");
      return { bytes, mimeType: "image/jpeg" };
    } finally {
      await unlink(output).catch(() => undefined);
    }
  }

  async getHealth(): Promise<DeviceHealth> {
    return { status: this.connectedDeviceId ? "ONLINE" : "OFFLINE", message: this.connectedDeviceId ? `${this.kind} connected` : `${this.kind} ready`, checkedAt: new Date().toISOString() };
  }
}
