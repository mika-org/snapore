import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { CameraAdapter, DeviceHealth, DiscoveredDevice } from "./contracts";

const execFileAsync = promisify(execFile);

type BridgeDevice = { id: string; name: string; capabilities?: Record<string, unknown> };

export class SdkBridgeCameraAdapter implements CameraAdapter {
  private connectedDeviceId: string | null = null;

  constructor(readonly kind: string, private readonly executable: string) {}

  private async run(args: string[]) {
    const { stdout } = await execFileAsync(this.executable, args, { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  }

  async discover(): Promise<DiscoveredDevice[]> {
    const output = await this.run(["discover", "--json"]);
    const devices = JSON.parse(output || "[]") as BridgeDevice[];
    return devices.map((device) => ({
      id: `${this.kind}:${device.id}`,
      fingerprint: `${this.kind.toLowerCase()}:${device.id}`,
      type: "CAMERA",
      kind: this.kind,
      name: device.name,
      status: "ONLINE",
      capabilities: { sdkBridge: true, ...device.capabilities },
    }));
  }

  async connect(deviceId: string) {
    this.connectedDeviceId = deviceId.startsWith(`${this.kind}:`) ? deviceId.slice(this.kind.length + 1) : deviceId;
    await this.run(["connect", "--device", this.connectedDeviceId]);
  }

  async disconnect() {
    if (this.connectedDeviceId) await this.run(["disconnect", "--device", this.connectedDeviceId]).catch(() => undefined);
    this.connectedDeviceId = null;
  }

  async getCapabilities() {
    if (!this.connectedDeviceId) return { sdkBridge: true, connected: false };
    const output = await this.run(["capabilities", "--device", this.connectedDeviceId, "--json"]);
    return JSON.parse(output || "{}") as Record<string, unknown>;
  }

  async capture() {
    if (!this.connectedDeviceId) throw new Error("Kamera SDK belum terhubung");
    const output = join(tmpdir(), `snapore-${randomUUID()}.jpg`);
    await this.run(["capture", "--device", this.connectedDeviceId, "--output", output]);
    try {
      return { bytes: await readFile(output), mimeType: "image/jpeg" };
    } finally {
      await unlink(output).catch(() => undefined);
    }
  }

  async getHealth(): Promise<DeviceHealth> {
    return { status: this.connectedDeviceId ? "ONLINE" : "OFFLINE", message: this.connectedDeviceId ? `${this.kind} connected` : `${this.kind} ready`, checkedAt: new Date().toISOString() };
  }
}
