import { describe, expect, it } from "vitest";
import { adjacentPhotoIndex, getPhotoKeyboardAction } from "./photo-editor-keyboard";

describe("photo editor keyboard navigation", () => {
  it("memilih atau menukar foto dari halaman review", () => {
    expect(getPhotoKeyboardAction({ key: "ArrowLeft" }, "REVIEW")).toBe("SELECT_PREVIOUS");
    expect(getPhotoKeyboardAction({ key: "ArrowRight", shiftKey: true }, "REVIEW")).toBe("SWAP_NEXT");
    expect(getPhotoKeyboardAction({ key: "e" }, "REVIEW")).toBe("OPEN_EDITOR");
    expect(getPhotoKeyboardAction({ key: "r" }, "REVIEW")).toBe("RETAKE");
  });

  it("mengatur transform dan perpindahan foto di editor", () => {
    expect(getPhotoKeyboardAction({ key: "ArrowUp" }, "EDITOR")).toBe("MOVE_UP");
    expect(getPhotoKeyboardAction({ key: "+" }, "EDITOR")).toBe("ZOOM_IN");
    expect(getPhotoKeyboardAction({ key: "PageDown" }, "EDITOR")).toBe("NEXT_PHOTO");
    expect(getPhotoKeyboardAction({ key: "Enter", ctrlKey: true }, "EDITOR")).toBe("SAVE_EDIT");
    expect(getPhotoKeyboardAction({ key: "Escape" }, "EDITOR")).toBe("CANCEL_EDIT");
  });

  it("mengabaikan shortcut review dengan modifier command", () => {
    expect(getPhotoKeyboardAction({ key: "e", ctrlKey: true }, "REVIEW")).toBeNull();
    expect(getPhotoKeyboardAction({ key: "ArrowRight", altKey: true }, "REVIEW")).toBeNull();
  });

  it("melakukan wrap saat berpindah foto", () => {
    expect(adjacentPhotoIndex(0, 4, -1)).toBe(3);
    expect(adjacentPhotoIndex(3, 4, 1)).toBe(0);
    expect(adjacentPhotoIndex(0, 0, 1)).toBe(0);
  });
});
