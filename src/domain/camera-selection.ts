export type BrowserCameraDevice = Pick<MediaDeviceInfo, "deviceId" | "label" | "kind">;
export type AgentCameraDevice = {
  id: string;
  fingerprint?: string;
  type: string;
  kind?: string;
  name: string;
  status: string;
  capabilities?: Record<string, unknown>;
};

function cameraScore(device: BrowserCameraDevice, mobile: boolean, avoidSdkControlledCamera: boolean) {
  const label = device.label.toLowerCase();
  let score = 0;
  if (/canon|eos|nikon|sony|fujifilm|panasonic|lumix|olympus|om system/.test(label)) score += 120;
  if (avoidSdkControlledCamera && /canon|eos/.test(label)) score -= 1_000;
  if (/logitech|elgato|razer|external|usb|webcam/.test(label)) score += 70;
  if (/front|user|facetime|integrated|built-in/.test(label)) score += mobile ? 90 : 35;
  if (/back|rear|environment/.test(label)) score += mobile ? 25 : 10;
  return score;
}

export function selectPreferredBrowserCamera(devices: BrowserCameraDevice[], userAgent = "", options: { avoidSdkControlledCamera?: boolean } = {}) {
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const mobile = /android|iphone|ipad|mobile|tablet/i.test(userAgent);
  return cameras
    .map((device, index) => ({ device, index, score: cameraScore(device, mobile, options.avoidSdkControlledCamera === true) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.device ?? null;
}

function agentCameraScore(device: AgentCameraDevice) {
  if (device.status !== "ONLINE") return -10_000;
  const text = `${device.kind ?? ""} ${device.name} ${device.id}`.toLowerCase();
  let score = 100;
  if (device.capabilities?.autoSelected === true) score += 5_000;
  if (/eos\s*r100/.test(text)) score += 2_000;
  if (/gphoto2_ptp|gphoto2 ptp/.test(text)) score += 1_200;
  if (/canon_edsdk|canon edsdk/.test(text)) score += 1_000;
  if (/canon|eos/.test(text)) score += 500;
  if (device.capabilities?.ptp === true) score += 150;
  if (device.capabilities?.sdkBridge === true) score += 100;
  return score;
}

export function selectPreferredAgentCamera(devices: AgentCameraDevice[] = []) {
  return devices
    .filter((device) => device.type === "CAMERA" && device.id !== "browser-camera")
    .map((device, index) => ({ device, index, score: agentCameraScore(device) }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.device ?? null;
}
