"use client";

import Image from "next/image";
import { CheckCircle2, ImagePlus, LoaderCircle, Plus, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { FrameCatalogItem, FrameCatalogResponse } from "@/domain/frame-catalog";

type UploadField = "grid2" | "grid4" | "grid6" | "grid8";

const uploads = [
  { field: "grid2" as const, count: 2 },
  { field: "grid4" as const, count: 4 },
  { field: "grid6" as const, count: 6 },
  { field: "grid8" as const, count: 8 },
];

function previewAsset(frame: FrameCatalogItem) {
  return frame.assets[4] ?? frame.assets[2] ?? frame.assets[6] ?? frame.assets[8];
}

export function FrameManager({ booths, canEdit = true, selectedBoothId, onBoothChange }: { booths: Array<{ id: string; code: string; name: string }>; canEdit?: boolean; selectedBoothId?: string; onBoothChange?: (boothId: string) => void }) {
  const [internalBoothId, setInternalBoothId] = useState(booths[0]?.id ?? "");
  const boothId = selectedBoothId ?? internalBoothId;
  const [frames, setFrames] = useState<FrameCatalogItem[]>([]);
  const [files, setFiles] = useState<Partial<Record<UploadField, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<UploadField, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const previewUrls = useRef(new Set<string>());

  const loadFrames = useCallback(async () => {
    setLoading(true);
    try {
      if (!boothId) {
        setFrames([]);
        return;
      }
      const response = await fetch(`/api/frames?boothId=${encodeURIComponent(boothId)}`, { cache: "no-store" });
      const payload = await response.json() as FrameCatalogResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Frame library gagal dimuat.");
      setFrames(payload.frames);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Frame library gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, [boothId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFrames(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFrames]);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const selectFile = (field: UploadField, file?: File) => {
    if (!file) return;
    if (file.type !== "image/png") {
      setError("Gunakan file PNG transparan berukuran 1200×1800 px.");
      return;
    }
    setError(null);
    setFiles((current) => ({ ...current, [field]: file }));
    setPreviews((current) => {
      const previous = current[field];
      if (previous) {
        URL.revokeObjectURL(previous);
        previewUrls.current.delete(previous);
      }
      const url = URL.createObjectURL(file);
      previewUrls.current.add(url);
      return { ...current, [field]: url };
    });
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>, field: UploadField) => {
    event.preventDefault();
    selectFile(field, event.dataTransfer.files[0]);
  };

  const resetUploads = () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    setFiles({});
    setPreviews({});
  };

  const closeForm = () => {
    if (saving) return;
    resetUploads();
    setError(null);
    setOpen(false);
  };

  const submitFrame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploads.some((upload) => !files[upload.field])) {
      setError("Pilih PNG untuk Grid 2, Grid 4, Grid 6, dan Grid 8 terlebih dahulu.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData(event.currentTarget);
      form.set("boothId", boothId);
      for (const upload of uploads) form.set(upload.field, files[upload.field] as File);
      const response = await fetch("/api/frames", { method: "POST", body: form });
      const payload = await response.json() as { frame?: FrameCatalogItem; error?: string };
      if (!response.ok || !payload.frame) throw new Error(payload.error ?? "Frame gagal disimpan.");

      setFrames((current) => [...current, payload.frame as FrameCatalogItem]);
      setSuccess(`${payload.frame.name} tersimpan ke database dan langsung tersedia di kiosk.`);
      resetUploads();
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Frame gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="frames">
      <div className="section-heading">
        <div><h2>Frame library</h2><p>{loading ? "Memuat frame..." : `${frames.length} frame aktif · tersimpan di PostgreSQL`}</p></div>
        <div className="frame-heading-actions"><select aria-label="Pilih booth frame" value={boothId} onChange={(event) => { setInternalBoothId(event.target.value); onBoothChange?.(event.target.value); }}>{booths.map((booth) => <option value={booth.id} key={booth.id}>{booth.code} · {booth.name}</option>)}</select>{canEdit ? <button className="primary-button coral" type="button" disabled={!boothId} onClick={() => { setOpen(true); setSuccess(null); }}><Plus size={15} /> New frame</button> : null}</div>
      </div>

      {success && <div className="frame-feedback success" role="status"><CheckCircle2 size={17} /> {success}</div>}
      {error && !open && <div className="frame-feedback error" role="alert">{error}<button type="button" onClick={() => void loadFrames()}>Coba lagi</button></div>}

      <div className="frame-grid">
        {frames.map((frame) => {
          const asset = previewAsset(frame);
          return (
            <article className="frame-card" key={frame.id}>
              <div className="frame-preview">
                {asset ? <Image src={asset} alt={`${frame.name} PNG frame`} fill unoptimized sizes="240px" style={{ objectFit: "contain" }} /> : <ImagePlus size={32} />}
              </div>
              <div className="frame-card-info">
                <div><h3>{frame.name}</h3><p>Grid {frame.variants.join("/")} · 1200×1800</p></div>
                <span className="database-badge">DB</span>
              </div>
            </article>
          );
        })}
        {!loading && frames.length === 0 && <div className="frame-empty"><ImagePlus size={28} /><strong>Belum ada frame pada booth ini</strong><span>Tambahkan empat PNG untuk Grid 2/4/6/8.</span></div>}
      </div>

      {open && (
        <div className="frame-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
          <section className="frame-modal" role="dialog" aria-modal="true" aria-labelledby="new-frame-title">
            <header>
              <div><span className="eyebrow"><ImagePlus size={13} /> New frame set</span><h2 id="new-frame-title">Tambah frame baru</h2><p>Satu nama frame dengan empat PNG transparan untuk seluruh jenis layout.</p></div>
              <button type="button" className="frame-modal-close" onClick={closeForm} aria-label="Tutup formulir"><X size={19} /></button>
            </header>
            <form onSubmit={submitFrame}>
              <div className="frame-form-copy">
                <label><span>Nama frame</span><input name="name" minLength={2} maxLength={80} required placeholder="Contoh: Midnight Bloom" /></label>
                <label><span>Deskripsi</span><textarea name="description" maxLength={240} rows={3} placeholder="Karakter visual dan kegunaan frame" /></label>
              </div>
              <div className="frame-upload-grid">
                {uploads.map((upload) => (
                  <label
                    className={`frame-upload ${previews[upload.field] ? "has-preview" : ""}`}
                    key={upload.field}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(event, upload.field)}
                  >
                    <input type="file" accept="image/png,.png" onChange={(event) => selectFile(upload.field, event.target.files?.[0])} />
                    {previews[upload.field]
                      ? <Image src={previews[upload.field]!} alt={`Preview Grid ${upload.count}`} fill unoptimized sizes="220px" style={{ objectFit: "contain" }} />
                      : <><Upload size={24} /><strong>Grid {upload.count}</strong><span>Drop atau pilih PNG</span></>}
                    <em>{files[upload.field]?.name ?? "1200 × 1800 px"}</em>
                  </label>
                ))}
              </div>
              {error && <div className="frame-feedback error" role="alert">{error}</div>}
              <footer>
                <p>PNG akan disimpan lokal; nama, path, checksum, dimensi, dan versi disimpan ke database.</p>
                <div><button className="secondary-button" type="button" onClick={closeForm} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />} {saving ? "Saving..." : "Save frame"}</button></div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
