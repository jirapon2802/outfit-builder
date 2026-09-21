"use client";

import { useEffect, useRef, useState } from "react";
import { categories, labels, type Category, type Garment } from "@/lib/outfit";
import { preparePhoto } from "@/lib/images";
import { Icon } from "./icons";

export function GarmentDialog({ garment, category, onClose, onSave, onDelete }: {
  garment?: Garment; category: Category; onClose: () => void;
  onSave: (garment: Garment) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(garment?.name || "");
  const [kind, setKind] = useState<Category>(garment?.category || category);
  const [photo, setPhoto] = useState<{ original: Blob; cutout?: Blob } | undefined>(garment);
  const [useCutout, setUseCutout] = useState(garment?.useCutout ?? true);
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(useCutout && photo.cutout ? photo.cutout : photo.original);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [photo, useCutout]);

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared); setUseCutout(!!prepared.cutout);
      if (!name) setName(file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").slice(0, 60));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open this photo."); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!photo || !name.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await onSave({ id: garment?.id || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: name.trim(), category: kind, ...photo, useCutout, createdAt: garment?.createdAt || Date.now() });
      onClose();
    } catch { setError("Could not save to this device. Storage may be full or blocked. Try removing an item."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!garment) return;
    setBusy(true);
    try { await onDelete(garment.id); onClose(); }
    catch { setError("Could not remove this item. Please try again."); setBusy(false); }
  }
  return <dialog ref={dialog} className="garment-dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}>
    <form onSubmit={save}>
      <header className="dialog-header"><div><span className="eyebrow">YOUR PERSONAL WARDROBE</span><h2 id="dialog-title">{garment ? "A closer look." : "Add something you love."}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><Icon name="close" /></button></header>
      <label className={`photo-upload ${src ? "has-photo" : ""}`}>
        {src ? <img src={src} alt="Garment photo preview" /> : <><span className="upload-icon"><Icon name="photo" size={32} /></span><strong>Choose a clothing photo</strong><span>One piece, a clear photo, a simple background.</span><small>JPG, PNG or WebP · up to 20 MB</small></>}
        {src && <span className="replace-photo">Change photo</span>}
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Clothing photo" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {busy && <p role="status">Preparing your piece…</p>}
      {photo && <div className="cleanup"><label><input type="checkbox" checked={!!photo.cutout && useCutout} disabled={!photo.cutout || busy} onChange={e => setUseCutout(e.target.checked)} /> Remove plain background</label><small>{photo.cutout ? "Check the edges. Switch off to keep the original photo." : "We kept the original to preserve your garment. Try a contrasting, plain background for a clean cutout."}</small></div>}
      <label className="field-label" htmlFor="garment-name">Name your piece</label><input id="garment-name" className="text-input" placeholder="e.g. Olive linen shirt" value={name} maxLength={60} required disabled={busy} onChange={e => setName(e.target.value)} />
      <label className="field-label" htmlFor="garment-category">Category</label><select id="garment-category" className="text-input" value={kind} disabled={busy} onChange={e => setKind(e.target.value as Category)}>{categories.map(c => <option key={c} value={c}>{labels[c]}</option>)}</select>
      <p className="small muted">Compressed and saved on this device. Background cleanup uses no AI credits.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="dialog-actions">{garment && <button type="button" className="text-button danger" disabled={busy} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={17} /> Delete</button>}<button type="submit" className="primary" disabled={!photo || !name.trim() || busy}>{garment ? "Save changes" : "Add to wardrobe"}<Icon name="arrow" size={18} /></button></footer>
      {confirmDelete && <div className="delete-confirm" role="alert"><p>Delete “{garment?.name}” from this device? Its photo will be removed.</p><button type="button" className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button><button type="button" className="primary danger-button" disabled={busy} onClick={remove}>Delete item</button></div>}
    </form>
  </dialog>;
}
