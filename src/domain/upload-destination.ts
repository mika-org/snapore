export function normalizeServerBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

export function serverApiUrl(baseUrl: string | null | undefined, path: string) {
  const base = normalizeServerBaseUrl(baseUrl);
  if (!base) return path.startsWith("/") ? path : `/${path}`;
  return new URL(path.replace(/^\/+/, ""), `${base}/`).toString();
}

export function publicUploadUrl(baseUrl: string | null | undefined, objectKey: string) {
  const base = normalizeServerBaseUrl(baseUrl);
  if (!base) return null;
  const safeKey = objectKey.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${base}/${safeKey}`;
}

export function publicAppUrl(baseUrl: string | null | undefined, path: string, fallbackOrigin: string) {
  return serverApiUrl(normalizeServerBaseUrl(baseUrl) ?? fallbackOrigin, path);
}
