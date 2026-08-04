import type { DiscoveredDevice, PrinterAdapter, PrintRequest } from "./contracts";

export class MockPrinterAdapter implements PrinterAdapter {
  readonly kind = "MOCK";
  private connected = false;

  async discover(): Promise<DiscoveredDevice[]> {
    return [
      {
        id: "mock-dnp-rx1",
        fingerprint: "mock:dnp:rx1:001",
        type: "PRINTER",
        kind: this.kind,
        name: "DNP DS-RX1 (simulator)",
        status: "ONLINE",
        capabilities: { media: ["4x6", "6x8"], dpi: [300], maxCopies: 10 },
      },
    ];
  }

  async connect() {
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  async getCapabilities() {
    return { media: ["4x6", "6x8"], dpi: [300], borderless: true };
  }

  async getHealth() {
    return { status: this.connected ? "ONLINE" as const : "OFFLINE" as const, checkedAt: new Date().toISOString() };
  }

  async print(request: PrintRequest) {
    if (!this.connected) throw new Error("Printer simulator belum terhubung");
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { spoolerId: `mock-spool-${request.jobId}`, status: "PRINTED" as const };
  }

  async cancel() {
    return true;
  }
}

export class OsSpoolerPrinterAdapter implements PrinterAdapter {
  readonly kind = "OS_SPOOLER";

  async discover(): Promise<DiscoveredDevice[]> {
    return [];
  }

  async connect() {
    throw new Error("Pilih driver printer OS pada konfigurasi agent sebelum mengaktifkan mode OS_SPOOLER");
  }

  async disconnect() {}

  async getCapabilities() {
    return { requiresDriver: true, supportedKinds: ["DNP", "EPSON", "GENERIC"] };
  }

  async getHealth() {
    return {
      status: "OFFLINE" as const,
      message: "Driver/model printer belum dikonfigurasi",
      checkedAt: new Date().toISOString(),
    };
  }

  async print(request: PrintRequest): Promise<{ spoolerId: string; status: "PRINTED" | "SPOOLING" }> {
    void request;
    throw new Error("OS spooler belum dikonfigurasi untuk model printer nyata");
  }

  async cancel() {
    return false;
  }
}
