import type { DiscoveredDevice } from "./contracts";

function normalizedCameraText(device: Pick<DiscoveredDevice, "id" | "kind" | "name">) {
  return `${device.kind} ${device.name} ${device.id}`.toLowerCase();
}

export function sdkCameraPriority(device: DiscoveredDevice, preferredModel = "EOS R100") {
  if (device.status === "OFFLINE") return -10_000;

  const text = normalizedCameraText(device);
  const preferred = preferredModel.trim().toLowerCase();
  let score = device.status === "ONLINE" ? 200 : 0;
  if (preferred && text.includes(preferred)) score += 2_000;
  if (/eos\s*r100/.test(text)) score += 1_500;
  if (/gphoto2_ptp|gphoto2 ptp/.test(text)) score += 1_000;
  if (/canon_edsdk|canon edsdk/.test(text)) score += 900;
  if (/canon|eos/.test(text)) score += 500;
  if (device.capabilities.ptp === true) score += 150;
  if (device.capabilities.sdkBridge === true) score += 100;
  return score;
}

export function rankSdkCameras<T extends { device: DiscoveredDevice }>(entries: T[], preferredModel = "EOS R100") {
  return entries
    .map((entry, index) => ({ entry, index, score: sdkCameraPriority(entry.device, preferredModel) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ entry }) => entry);
}
