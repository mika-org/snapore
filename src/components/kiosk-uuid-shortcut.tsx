"use client";

import { ArrowRight, Keyboard, MonitorSmartphone, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { kioskPath, kioskUuidFromInput, normalizedKeyboardKey } from "@/domain/kiosk-shortcut";

const SHORTCUT_WINDOW_MS = 1_500;

function shortcutEnabled(pathname: string) {
  return pathname === "/login" || pathname === "/admin" || pathname === "/super-admin";
}

export function KioskUuidShortcut() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [uuidInput, setUuidInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const armedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const enabled = shortcutEnabled(pathname);

  const openDialog = () => {
    setError(null);
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    setError(null);
  };

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.metaKey) return;
      const key = normalizedKeyboardKey(event);
      if (key === "escape" && open) {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (key === "x" && performance.now() - armedAt.current <= SHORTCUT_WINDOW_MS) {
        event.preventDefault();
        armedAt.current = 0;
        openDialog();
        return;
      }
      if (!event.ctrlKey) return;
      if (key === "z") {
        event.preventDefault();
        armedAt.current = performance.now();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!enabled) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const uuid = kioskUuidFromInput(uuidInput);
    if (!uuid) {
      setError("UUID kiosk tidak valid. Gunakan format UUID atau tempel link kiosk lengkap.");
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    setUuidInput("");
    closeDialog();
    router.push(kioskPath(uuid));
  };

  return (
    <>
      {!open && <button className="kiosk-shortcut-trigger" type="button" onClick={openDialog} aria-label="Buka kiosk dengan UUID"><MonitorSmartphone size={15} /><span>Buka kiosk</span><kbd>Ctrl</kbd><b>+</b><kbd>Z</kbd><b>+</b><kbd>X</kbd></button>}
      {open && <div className="kiosk-shortcut-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
        <section className="kiosk-shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="kiosk-shortcut-title">
          <header><div className="kiosk-shortcut-icon"><MonitorSmartphone size={21} /></div><div><span><Keyboard size={13} /> Ctrl + Z + X</span><h2 id="kiosk-shortcut-title">Buka kiosk dari UUID</h2><p>Masukkan UUID booth atau tempel link kiosk lengkap.</p></div><button type="button" onClick={closeDialog} aria-label="Tutup shortcut kiosk"><X size={18} /></button></header>
          <form onSubmit={submit}>
            <label htmlFor="kiosk-shortcut-uuid">UUID kiosk</label>
            <input ref={inputRef} id="kiosk-shortcut-uuid" value={uuidInput} onChange={(event) => { setUuidInput(event.target.value); setError(null); }} placeholder="e19c279f-4f39-4b9f-a6c5-18e32740ea18" autoComplete="off" spellCheck={false} />
            <small>Tujuan: /kiosk/{kioskUuidFromInput(uuidInput) ?? "{uuid}"}</small>
            {error && <div className="kiosk-shortcut-error" role="alert">{error}</div>}
            <footer><button className="secondary-button" type="button" onClick={closeDialog}>Batal</button><button className="primary-button" type="submit">Buka kiosk <ArrowRight size={15} /></button></footer>
          </form>
        </section>
      </div>}
    </>
  );
}
