export type BrowserCameraDevice = Pick<MediaDeviceInfo, "deviceId" | "label" | "kind">;

function cameraScore(device: BrowserCameraDevice, mobile: boolean) {
  const label = device.label.toLowerCase();
  let score = 0;
  if (/canon|eos|nikon|sony|fujifilm|panasonic|lumix|olympus|om system/.test(label)) score += 120;
  if (/logitech|elgato|razer|external|usb|webcam/.test(label)) score += 70;
  if (/front|user|facetime|integrated|built-in/.test(label)) score += mobile ? 90 : 35;
  if (/back|rear|environment/.test(label)) score += mobile ? 25 : 10;
  return score;
}

export function selectPreferredBrowserCamera(devices: BrowserCameraDevice[], userAgent = "") {
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const mobile = /android|iphone|ipad|mobile|tablet/i.test(userAgent);
  return cameras
    .map((device, index) => ({ device, index, score: cameraScore(device, mobile) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.device ?? null;
}
