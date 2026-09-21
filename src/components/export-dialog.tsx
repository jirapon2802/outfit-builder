"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export function ExportDialog({ blob, onClose }: { blob: Blob; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState("");
  const [message, setMessage] = useState("");
  const [canShare, setCanShare] = useState(false);
  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
  const filename = `my-outfit.${extension}`;
  useEffect(() => {
    dialog.current?.showModal();
    const url = URL.createObjectURL(blob); setSrc(url);
    setCanShare(!!navigator.canShare?.({ files: [new File([blob], filename, { type: blob.type })] }));
    return () => URL.revokeObjectURL(url);
  }, [blob, filename]);
  async function share() {
    try { await navigator.share({ files: [new File([blob], filename, { type: blob.type })], title: "My outfit" }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setMessage("Sharing is unavailable. Use Save image or press and hold the preview."); }
  }
  return <dialog ref={dialog} className="garment-dialog export-dialog" aria-labelledby="export-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <header className="dialog-header"><div><span className="eyebrow">TAKE YOUR LOOK WITH YOU</span><h2 id="export-title">Ready to save.</h2></div><button className="icon-button" aria-label="Close export" onClick={onClose}><Icon name="close" /></button></header>
    {src && <img className="export-image" src={src} alt="Your outfit, ready to download" />}
    <p className="small muted">Save the image, or press and hold the preview on your phone.</p>
    <div className="dialog-actions">{canShare && <button className="secondary" onClick={share}>Share or save</button>}<a className="primary" href={src || undefined} download={filename} onClick={() => setMessage("If your browser opens the image, use its save-image option.")}><Icon name="download" size={17} /> Save image</a></div>
    {message && <p className="small muted" role="status">{message}</p>}
  </dialog>;
}
