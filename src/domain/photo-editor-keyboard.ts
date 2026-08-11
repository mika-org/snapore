export type PhotoKeyboardMode = "REVIEW" | "EDITOR";

export type PhotoKeyboardAction =
  | "SELECT_PREVIOUS"
  | "SELECT_NEXT"
  | "SWAP_PREVIOUS"
  | "SWAP_NEXT"
  | "OPEN_EDITOR"
  | "RETAKE"
  | "MOVE_LEFT"
  | "MOVE_RIGHT"
  | "MOVE_UP"
  | "MOVE_DOWN"
  | "ZOOM_IN"
  | "ZOOM_OUT"
  | "ROTATE_LEFT"
  | "ROTATE_RIGHT"
  | "TOGGLE_MIRROR"
  | "RESET_EDIT"
  | "PREVIOUS_PHOTO"
  | "NEXT_PHOTO"
  | "SAVE_EDIT"
  | "CANCEL_EDIT";

type KeyboardInput = {
  key?: unknown;
  code?: unknown;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

function keyboardKey(event: KeyboardInput) {
  const value = typeof event.key === "string" && event.key
    ? event.key
    : typeof event.code === "string"
      ? event.code.replace(/^Key/, "")
      : "";

  return value.toLowerCase();
}

export function adjacentPhotoIndex(current: number, total: number, direction: -1 | 1) {
  if (total <= 0) return 0;
  return (Math.max(0, current) + direction + total) % total;
}

export function getPhotoKeyboardAction(event: KeyboardInput, mode: PhotoKeyboardMode): PhotoKeyboardAction | null {
  const key = keyboardKey(event);
  const command = Boolean(event.ctrlKey || event.metaKey);

  if (mode === "REVIEW") {
    if (command || event.altKey) return null;
    if (key === "arrowleft") return event.shiftKey ? "SWAP_PREVIOUS" : "SELECT_PREVIOUS";
    if (key === "arrowright") return event.shiftKey ? "SWAP_NEXT" : "SELECT_NEXT";
    if (key === "enter" || key === "e") return "OPEN_EDITOR";
    if (key === "r") return "RETAKE";
    return null;
  }

  if (key === "escape") return "CANCEL_EDIT";
  if (command && key === "enter") return "SAVE_EDIT";
  if (command || event.altKey) return null;
  if (key === "arrowleft") return "MOVE_LEFT";
  if (key === "arrowright") return "MOVE_RIGHT";
  if (key === "arrowup") return "MOVE_UP";
  if (key === "arrowdown") return "MOVE_DOWN";
  if (key === "+" || key === "=") return "ZOOM_IN";
  if (key === "-" || key === "_") return "ZOOM_OUT";
  if (key === "q") return "ROTATE_LEFT";
  if (key === "e") return "ROTATE_RIGHT";
  if (key === "m") return "TOGGLE_MIRROR";
  if (key === "0") return "RESET_EDIT";
  if (key === "pageup" || key === "[" || key === "bracketleft") return "PREVIOUS_PHOTO";
  if (key === "pagedown" || key === "]" || key === "bracketright") return "NEXT_PHOTO";
  return null;
}
