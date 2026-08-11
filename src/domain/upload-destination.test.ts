import { describe, expect, it } from "vitest";
import { normalizeServerBaseUrl, publicAppUrl, publicUploadUrl, serverApiUrl } from "./upload-destination";

describe("upload destination", () => {
  it("menormalkan URL server dan membangun endpoint sync", () => {
    expect(normalizeServerBaseUrl("https://photobooth.elevore.web.id///")).toBe("https://photobooth.elevore.web.id");
    expect(serverApiUrl("https://photobooth.elevore.web.id/", "/api/sync/sessions")).toBe("https://photobooth.elevore.web.id/api/sync/sessions");
  });

  it("tetap memakai endpoint relatif saat server online tidak dikonfigurasi", () => {
    expect(serverApiUrl(undefined, "api/sync/sessions")).toBe("/api/sync/sessions");
  });

  it("membangun URL asset publik secara aman", () => {
    expect(publicUploadUrl("https://photobooth.elevore.web.id/uploads/", "BOOTH 1/session/file.jpg"))
      .toBe("https://photobooth.elevore.web.id/uploads/BOOTH%201/session/file.jpg");
  });

  it("membangun URL galeri absolut dengan fallback origin", () => {
    expect(publicAppUrl(undefined, "/g/token", "http://localhost:3000")).toBe("http://localhost:3000/g/token");
  });
});
