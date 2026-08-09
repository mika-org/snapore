"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus, LoaderCircle, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { FrameCatalogItem, FrameCatalogResponse } from "@/domain/frame-catalog";
import { SearchableSelect } from "@/components/searchable-select";

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
  const router = useRouter();
  const [internalBoothId, setInternalBoothId] = useState(booths[0]?.id ?? "");
  const boothId = selectedBoothId ?? internalBoothId;
  const [frames, setFrames] = useState<FrameCatalogItem[]>([]);
  const [files, setFiles] = useState<Partial<Record<UploadField, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<UploadField, string>>>({});
  const [removedFields, setRemovedFields] = useState<Set<UploadField>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingFrame, setEditingFrame] = useState<FrameCatalogItem | null>(null);
  const [deletingFrame, setDeletingFrame] = useState<FrameCatalogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
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
      setError("Gunakan PNG transparan dengan lubang foto sesuai jumlah grid. Portrait/landscape akan terdeteksi otomatis.");
      return;
    }
    setError(null);
    setRemovedFields((current) => { const next = new Set(current); next.delete(field); return next; });
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
    setRemovedFields(new Set());
  };

  const removeGridAsset = (field: UploadField, hasExistingAsset: boolean) => {
    setFiles((current) => { const next = { ...current }; delete next[field]; return next; });
    setPreviews((current) => {
      const previous = current[field];
      if (previous) { URL.revokeObjectURL(previous); previewUrls.current.delete(previous); }
      const next = { ...current };
      delete next[field];
      return next;
    });
    if (hasExistingAsset) setRemovedFields((current) => new Set(current).add(field));
  };

  const closeForm = () => {
    if (saving) return;
    resetUploads();
    setError(null);
    setOpen(false);
    setEditingFrame(null);
  };

  const submitFrame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const uploadedFields = uploads.filter((upload) => Boolean(files[upload.field]));
    if (!editingFrame && uploadedFields.length === 0) {
      setError("Pilih minimal satu PNG frame (Grid 2, 4, 6, atau 8) terlebih dahulu.");
      return;
    }
    if (editingFrame) {
      const remainingVariants = uploads.filter((upload) => {
        const hasExisting = Boolean(editingFrame.assets[upload.count as keyof FrameCatalogItem["assets"]]);
        return Boolean(files[upload.field]) || (hasExisting && !removedFields.has(upload.field));
      });
      if (remainingVariants.length === 0) {
        setError("Minimal satu Grid 2, 4, 6, atau 8 harus tetap tersedia pada frame.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData(event.currentTarget);
      form.set("boothId", boothId);
      if (editingFrame) form.set("id", editingFrame.id);
      if (editingFrame) form.set("removedLayouts", JSON.stringify(uploads.filter((upload) => removedFields.has(upload.field)).map((upload) => upload.count)));
      for (const upload of uploadedFields) {
        form.set(upload.field, files[upload.field] as File);
      }
      const method = editingFrame ? "PUT" : "POST";
      const response = await fetch("/api/frames", { method, body: form });
      const payload = await response.json() as { frame?: FrameCatalogItem; error?: string };
      if (!response.ok || !payload.frame) throw new Error(payload.error ?? "Frame gagal disimpan.");

      if (editingFrame) {
        setFrames((current) => current.map((item) => (item.id === payload.frame!.id ? payload.frame! : item)));
        setSuccess(`${payload.frame.name} berhasil diperbarui.`);
      } else {
        setFrames((current) => [...current, payload.frame as FrameCatalogItem]);
        setSuccess(`${payload.frame.name} tersimpan ke database dan langsung tersedia di kiosk.`);
      }
      resetUploads();
      setOpen(false);
      setEditingFrame(null);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Frame gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingFrame) return;
    setDeleting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/frames?id=${encodeURIComponent(deletingFrame.id)}&boothId=${encodeURIComponent(boothId)}`, {
        method: "DELETE",
      });
      const payload = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Frame gagal dihapus.");

      setFrames((current) => current.filter((item) => item.id !== deletingFrame.id));
      setSuccess(`Frame ${deletingFrame.name} berhasil dihapus.`);
      setDeletingFrame(null);
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Frame gagal dihapus.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section id="frames">
      <div className="section-heading">
        <div><h2>Frame library</h2><p>{loading ? "Memuat frame..." : `${frames.length} frame aktif · tersimpan di PostgreSQL`}</p></div>
        <div className="frame-heading-actions"><SearchableSelect ariaLabel="Pilih booth frame" value={boothId} onValueChange={(value) => { setInternalBoothId(value); onBoothChange?.(value); }} searchPlaceholder="Cari booth..." options={booths.map((booth) => ({ value: booth.id, label: `${booth.code} · ${booth.name}` }))} />{canEdit ? <button className="primary-button coral" type="button" disabled={!boothId} onClick={() => { setOpen(true); setEditingFrame(null); resetUploads(); setSuccess(null); }}><Plus size={15} /> New frame</button> : null}</div>
      </div>

      {success && <div className="frame-feedback success" role="status"><CheckCircle2 size={17} /> {success}</div>}
      {error && !open && !editingFrame && !deletingFrame && <div className="frame-feedback error" role="alert">{error}<button type="button" onClick={() => void loadFrames()}>Coba lagi</button></div>}

      <div className="frame-grid">
        {frames.map((frame) => {
          const asset = previewAsset(frame);
          return (
            <article className="frame-card" key={frame.id}>
              <div className="frame-preview">
                {asset ? <Image src={asset} alt={`${frame.name} PNG frame`} fill unoptimized sizes="240px" style={{ objectFit: "contain" }} /> : <ImagePlus size={32} />}
              </div>
              <div className="frame-card-info">
                <div><h3>{frame.name}</h3><p>Grid {frame.variants.join("/")}</p></div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${frame.name}`}
                        title="Edit frame"
                        onClick={() => {
                          setEditingFrame(frame);
                          resetUploads();
                          setError(null);
                        }}
                        style={{ padding: 5, cursor: "pointer", background: "none", border: "none", color: "#444", borderRadius: 6 }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Hapus ${frame.name}`}
                        title="Hapus frame"
                        onClick={() => {
                          setDeletingFrame(frame);
                          setError(null);
                        }}
                        style={{ padding: 5, cursor: "pointer", background: "none", border: "none", color: "#e03e2d", borderRadius: 6 }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                  <span className="database-badge">DB</span>
                </div>
              </div>
            </article>
          );
        })}
        {!loading && frames.length === 0 && <div className="frame-empty"><ImagePlus size={28} /><strong>Belum ada frame pada booth ini</strong><span>Tambahkan minimal satu PNG untuk Grid 2/4/6/8.</span></div>}
      </div>

      {(open || editingFrame) && (
        <div className="frame-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
          <section className="frame-modal" role="dialog" aria-modal="true" aria-labelledby="new-frame-title">
            <header>
              <div>
                <span className="eyebrow"><ImagePlus size={13} /> {editingFrame ? "Edit Frame" : "New frame set"}</span>
                <h2 id="new-frame-title">{editingFrame ? `Edit ${editingFrame.name}` : "Tambah frame baru"}</h2>
                <p>{editingFrame ? "Ubah nama, deskripsi, atau ganti/tambah PNG layout grid." : "Satu nama frame dengan PNG transparan untuk jenis layout yang dipilih (minimal 1 layout)."}</p>
              </div>
              <button type="button" className="frame-modal-close" onClick={closeForm} aria-label="Tutup formulir"><X size={19} /></button>
            </header>
            <form onSubmit={submitFrame}>
              <div className="frame-form-copy">
                <label><span>Nama frame</span><input name="name" defaultValue={editingFrame?.name ?? ""} minLength={2} maxLength={80} required placeholder="Contoh: Midnight Bloom" /></label>
                <label><span>Deskripsi</span><textarea name="description" defaultValue={editingFrame?.description ?? ""} maxLength={240} rows={3} placeholder="Karakter visual dan kegunaan frame" /></label>
              </div>
              <div className="frame-upload-grid">
                {uploads.map((upload) => {
                  const existingAsset = editingFrame?.assets[upload.count as keyof FrameCatalogItem["assets"]];
                  const isRemoved = removedFields.has(upload.field);
                  const currentPreview = previews[upload.field] ?? (isRemoved ? undefined : existingAsset);
                  return (
                    <div className={`frame-upload-slot ${isRemoved ? "marked-removed" : ""}`} key={upload.field}>
                      <label
                        className={`frame-upload ${currentPreview ? "has-preview" : ""}`}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, upload.field)}
                      >
                        <input type="file" accept="image/png,.png" onChange={(event) => selectFile(upload.field, event.target.files?.[0])} />
                        <span className="upload-grid-badge">Grid {upload.count}</span>
                        {currentPreview
                          ? <Image src={currentPreview} alt={`Preview Grid ${upload.count}`} fill unoptimized sizes="220px" style={{ objectFit: "contain" }} />
                          : <><Upload size={24} /><strong>{isRemoved ? `Grid ${upload.count} dihapus` : `Grid ${upload.count}`}</strong><span>{isRemoved ? "Simpan perubahan atau upload pengganti" : "Drop atau pilih PNG"}</span></>}
                        <em>{files[upload.field]?.name ?? (isRemoved ? `Grid ${upload.count} akan dihapus` : existingAsset ? `Grid ${upload.count} (Ada)` : `${upload.count} lubang transparan · auto orientation`)}</em>
                      </label>
                      {editingFrame && (currentPreview || isRemoved) ? <button className={`frame-grid-remove ${isRemoved ? "restore" : ""}`} type="button" onClick={() => isRemoved ? setRemovedFields((current) => { const next = new Set(current); next.delete(upload.field); return next; }) : removeGridAsset(upload.field, Boolean(existingAsset))} aria-label={isRemoved ? `Batalkan hapus Grid ${upload.count}` : `Hapus Grid ${upload.count}`}>{isRemoved ? <><Upload size={13} /> Pulihkan</> : <><Trash2 size={13} /> Hapus grid</>}</button> : null}
                    </div>
                  );
                })}
              </div>
              {error && <div className="frame-feedback error" role="alert">{error}</div>}
              <footer>
                <p>PNG dinormalisasi tanpa distorsi, area transparan dideteksi sebagai slot foto, lalu path, checksum, dimensi, dan versi disimpan ke database.</p>
                <div>
                  <button className="secondary-button" type="button" onClick={closeForm} disabled={saving}>Cancel</button>
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                    {saving ? "Saving..." : editingFrame ? "Update frame" : "Save frame"}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}

      {deletingFrame && (
        <div className="frame-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeletingFrame(null); }}>
          <section className="frame-modal" style={{ width: "min(480px, 100%)" }} role="dialog" aria-modal="true" aria-labelledby="delete-frame-title">
            <header>
              <div>
                <span className="eyebrow" style={{ color: "#e03e2d" }}><Trash2 size={13} /> Delete Frame</span>
                <h2 id="delete-frame-title">Hapus Frame</h2>
                <p>Apakah Anda yakin ingin menghapus frame <strong>{deletingFrame.name}</strong> dari booth ini?</p>
              </div>
              <button type="button" className="frame-modal-close" onClick={() => setDeletingFrame(null)} disabled={deleting} aria-label="Tutup"><X size={19} /></button>
            </header>
            {error && <div className="frame-feedback error" style={{ margin: "16px 20px 0" }} role="alert">{error}</div>}
            <footer style={{ padding: "20px 24px" }}>
              <p>Histori foto lama tetap aman. Frame tidak akan tampil lagi untuk sesi pelanggan baru.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="secondary-button" type="button" onClick={() => setDeletingFrame(null)} disabled={deleting}>Batal</button>
                <button className="primary-button" style={{ background: "#e03e2d", borderColor: "#c02e1d", color: "white" }} type="button" onClick={() => void confirmDelete()} disabled={deleting}>
                  {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
                  {deleting ? "Hapus..." : "Hapus Frame"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
