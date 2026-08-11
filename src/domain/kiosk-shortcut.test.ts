import { describe, expect, it } from "vitest";
import { kioskPath, kioskUuidFromInput, normalizedKeyboardKey } from "./kiosk-shortcut";

const uuid = "e19c279f-4f39-4b9f-a6c5-18e32740ea18";

describe("kiosk shortcut", () => {
  it("menerima UUID kiosk", () => {
    expect(kioskUuidFromInput(uuid.toUpperCase())).toBe(uuid);
  });

  it("menerima path dan URL kiosk tanpa membuat open redirect", () => {
    expect(kioskUuidFromInput(`/kiosk/${uuid}`)).toBe(uuid);
    expect(kioskUuidFromInput(`https://example.test/kiosk/${uuid}?preview=1`)).toBe(uuid);
    expect(kioskPath(uuid)).toBe(`/kiosk/${uuid}`);
  });

  it("menolak nilai non-UUID", () => {
    expect(kioskUuidFromInput("LOCAL-001")).toBeNull();
    expect(kioskUuidFromInput("https://example.test/kiosk/bukan-uuid")).toBeNull();
  });

  it("menangani event keyboard tanpa key dan memakai code sebagai fallback", () => {
    expect(normalizedKeyboardKey({})).toBe("");
    expect(normalizedKeyboardKey({ key: undefined, code: "KeyX" })).toBe("x");
    expect(normalizedKeyboardKey({ key: "Escape", code: "" })).toBe("escape");
  });
});
