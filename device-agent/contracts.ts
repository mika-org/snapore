export type DeviceHealth = {
  status: "ONLINE" | "OFFLINE" | "DEGRADED";
  message?: string;
  checkedAt: string;
};

export type DiscoveredDevice = {
  id: string;
  fingerprint: string;
  type: "CAMERA" | "PRINTER";
  kind: string;
  name: string;
  status: DeviceHealth["status"];
  capabilities: Record<string, unknown>;
};

export interface CameraAdapter {
  readonly kind: string;
  discover(): Promise<DiscoveredDevice[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<Record<string, unknown>>;
  capture(options?: Record<string, unknown>): Promise<{ bytes: Buffer; mimeType: string }>;
  getHealth(): Promise<DeviceHealth>;
}

export type PrintRequest = {
  jobId: string;
  filePath: string;
  copies: number;
  profile: {
    mediaName: string;
    dpi: number;
    orientation: "portrait" | "landscape";
    borderless: boolean;
    photoPaper: boolean;
    queueName?: string;
    dnpCutQueueName?: string;
    dnpTwoInchCut: boolean;
  };
};

export interface PrinterAdapter {
  readonly kind: string;
  discover(): Promise<DiscoveredDevice[]>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(): Promise<Record<string, unknown>>;
  getHealth(): Promise<DeviceHealth>;
  getConsumables?(): Promise<{ paperRemaining: number; paperCapacity: number; source: "SENSOR" } | undefined>;
  print(request: PrintRequest): Promise<{ spoolerId: string; status: "PRINTED" | "SPOOLING" }>;
  cancel(jobId: string): Promise<boolean>;
}
