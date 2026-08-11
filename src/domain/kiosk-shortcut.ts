const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizedKeyboardKey(event: { key?: unknown; code?: unknown }) {
  const key = typeof event.key === "string" && event.key
    ? event.key
    : typeof event.code === "string"
      ? event.code.replace(/^Key/, "")
      : "";

  return key.toLowerCase();
}

export function kioskUuidFromInput(value: string) {
  const input = value.trim();
  if (!input) return null;

  const pathMatch = input.match(/(?:^|\/)kiosk\/([^/?#]+)/i);
  const candidate = decodeURIComponent(pathMatch?.[1] ?? input).trim();
  return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function kioskPath(uuid: string) {
  return `/kiosk/${uuid}`;
}
