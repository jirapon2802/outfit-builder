"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { categories, formatBytes, generationBlock, labels, restoreSelection, singular, type Category, type DisplayGarment, type Garment, type Presentation, type Selection } from "@/lib/outfit";
import { deleteGarment, readPreferences, readWardrobe, saveGarment, savePreferences } from "@/lib/wardrobe";
import { createCollage } from "@/lib/images";
import { GarmentDialog } from "./garment-dialog";
import { ExportDialog } from "./export-dialog";
import { Icon } from "./icons";

export default function OutfitBuilder() {
  const [garments, setGarments] = useState<Garment[]>([]);
  const [display, setDisplay] = useState<DisplayGarment[]>([]);
  const [selection, setSelection] = useState<Selection>({});
  const [presentation, setPresentation] = useState<Presentation>("masculine");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{ garment?: Garment; category: Category } | null>(null);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [limitedUntil, setLimitedUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exportBlob, setExportBlob] = useState<Blob | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState("");
  const [view, setView] = useState<"collage" | "ai">("collage");
  const inFlight = useRef(false);
  const board = useRef<HTMLElement>(null);

  async function checkAI() {
    setChecking(true);
    try {
      const response = await fetch("/api/try-on", { cache: "no-store" });
      const data = await response.json();
      setAvailable(response.ok && data.available === true);
    } catch { setAvailable(false); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    let active = true;
    Promise.all([readWardrobe(), readPreferences()]).then(([items, prefs]) => {
      if (!active) return;
      setGarments(items);
      if (prefs) { setSelection(restoreSelection(prefs.selection, items)); setPresentation(prefs.presentation === "feminine" ? "feminine" : "masculine"); }
      setReady(true);
    }).catch(() => { if (active) { setStorageFailed(true); setNotice("Device storage is unavailable. Allow browser storage, then reload to save your wardrobe."); setReady(true); } });
    void checkAI();
    try { const until = Number(localStorage.getItem("outfit-ai-retry")); if (until > Date.now()) setLimitedUntil(until); } catch { /* storage error is handled by the wardrobe */ }
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const items = garments.map(g => ({ ...g, src: URL.createObjectURL(g.useCutout && g.cutout ? g.cutout : g.original) }));
    setDisplay(items);
    return () => items.forEach(g => URL.revokeObjectURL(g.src));
  }, [garments]);
  useEffect(() => {
    if (ready && !storageFailed) savePreferences({ selection, presentation }).catch(() => setNotice("Your latest selections could not be saved on this device."));
  }, [selection, presentation, ready, storageFailed]);
  useEffect(() => {
    if (!result) { setResultUrl(""); return; }
    const url = URL.createObjectURL(result); setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  useEffect(() => {
    if (!limitedUntil) return;
    const timer = setTimeout(() => { setLimitedUntil(0); try { localStorage.removeItem("outfit-ai-retry"); } catch {} }, Math.max(0, limitedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [limitedUntil]);

  const pieces = Object.fromEntries(categories.map(c => [c, display.find(g => g.id === selection[c] && g.category === c)])) as Partial<Record<Category, DisplayGarment>>;
  const selectedCount = categories.filter(c => pieces[c]).length;
  const requiredCount = ["top", "bottom", "shoes"].filter(c => selection[c as Category]).length;
  const visible = display.filter(g => (filter === "all" || g.category === filter) && g.name.toLowerCase().includes(search.toLowerCase()));
  const block = generationBlock(selection, available, busy, limitedUntil > Date.now());
  const usedBytes = garments.reduce((sum, g) => sum + g.original.size + (g.cutout?.size || 0), 0);

  function invalidate() { setResult(null); setView("collage"); }
  function choose(category: Category, id?: string) {
    if (inFlight.current) return;
    invalidate(); setSelection(prev => ({ ...prev, [category]: prev[category] === id ? undefined : id }));
  }
  async function save(item: Garment) {
    await saveGarment(item);
    setGarments(prev => [item, ...prev.filter(g => g.id !== item.id)]);
    setSelection(prev => {
      const next = { ...prev };
      for (const c of categories) if (next[c] === item.id && c !== item.category) delete next[c];
      return next;
    });
    invalidate(); setNotice(`“${item.name}” saved to your wardrobe.`);
  }
  async function remove(id: string) {
    await deleteGarment(id);
    setGarments(prev => prev.filter(g => g.id !== id));
    setSelection(prev => Object.fromEntries(Object.entries(prev).filter(([, value]) => value !== id)));
    invalidate(); setNotice("Item removed from this device.");
  }
  async function generate() {
    if (block || inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      const form = new FormData(); form.set("presentation", presentation);
      for (const c of ["top", "bottom", "shoes"] as const) form.set(c, pieces[c]!.original, `${c}.webp`);
      const response = await fetch("/api/try-on", { method: "POST", body: form });
      if (!response.ok) {
        const data = await response.json();
        if (response.status === 429) {
          const until = Date.now() + Math.min(86400, Math.max(60, Number(data.retryAfter) || 3600)) * 1000;
          setLimitedUntil(until); try { localStorage.setItem("outfit-ai-retry", String(until)); } catch {}
        }
        if (response.status === 503) setAvailable(false);
        throw new Error(data.error || "AI preview is unavailable. Your collage is ready to use.");
      }
      if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("AI did not return an image. Please try again later.");
      setResult(await response.blob()); setView("ai"); setNotice("Your AI preview is ready.");
    } catch (error) { setView("collage"); setNotice(error instanceof Error ? error.message : "Could not generate. Your collage is still available."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function download() {
    setDownloading(true);
    try { setExportBlob(view === "ai" && result ? result : await createCollage(pieces)); }
    catch { setNotice("Could not download your preview. Please try again."); }
    finally { setDownloading(false); }
  }

  return <>
    <header className="site-header"><Link href="/" className="brand" aria-label="Outfit Builder home"><span className="brand-mark"><Icon name="hanger" size={26} /></span>outfit builder<span className="brand-dot">.</span></Link><span className="header-note">A little less “what should I wear?”</span><span className="personal-badge"><span /> Personal studio</span></header>
    <main className="workspace">
      <section className="intro"><div><p className="eyebrow"><span className="tiny-line" /> YOUR EVERYDAY STYLING SPACE</p><h1>Good pieces.<br className="mobile-break" /> <em>Great together.</em></h1><p className="intro-copy">Your clothes, a few combinations, a whole new point of view.</p></div><button className="primary add-main" disabled={!ready || storageFailed || busy} onClick={() => setDialog({ category: filter === "all" ? "top" : filter })}><Icon name="plus" size={19} /> Add a piece</button></section>
      {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice("")}><Icon name="close" size={17} /></button></div>}
      <div className="studio-layout">
        <section className="wardrobe" aria-labelledby="wardrobe-title">
          <div className="section-heading"><div className="title-line"><h2 id="wardrobe-title">Your wardrobe</h2><span className="count">{garments.length}</span></div><span className="small muted">A home for your favorites</span></div>
          <div className="filters" aria-label="Filter wardrobe">{(["all", ...categories] as const).map(c => <button key={c} className={filter === c ? "filter active" : "filter"} aria-pressed={filter === c} onClick={() => setFilter(c)}>{c !== "all" && <Icon name={c} size={17} />}{c === "all" ? "All pieces" : labels[c]}</button>)}</div>
          {garments.length > 0 && <div className="search-row"><input type="search" aria-label="Search your wardrobe" placeholder="Find a piece…" value={search} onChange={e => setSearch(e.target.value)} /><span>{visible.length} {visible.length === 1 ? "piece" : "pieces"}</span></div>}
          {!ready ? <div className="empty-wardrobe"><span className="loader" /><p>Opening your wardrobe…</p></div> : garments.length === 0 ? <div className="empty-wardrobe"><div className="empty-art"><div className="art-tag">YOUR STYLE STARTS HERE</div><Icon name="hanger" size={94} /><span className="art-plus">+</span></div><h3>A wardrobe full of possibilities.</h3><p>Start with a piece you already love.<br />Add a photo, then find its perfect match.</p><button className="primary" disabled={storageFailed || busy} onClick={() => setDialog({ category: filter === "all" ? "top" : filter })}><Icon name="plus" size={18} /> Add your first piece</button><span className="empty-footnote">No shopping required. Just your own good taste.</span></div> : <div className="garment-grid">{visible.map(g => <article key={g.id} className={`garment-card ${selection[g.category] === g.id ? "selected" : ""}`}><button className="garment-select" aria-label={`Select ${g.name}`} aria-pressed={selection[g.category] === g.id} disabled={busy} onClick={() => choose(g.category, g.id)}><div className="garment-image"><img src={g.src} alt={g.name} /><span className="selection-tick"><Icon name={selection[g.category] === g.id ? "check" : "plus"} size={16} /></span></div><div className="garment-description"><strong>{g.name}</strong><span>{singular[g.category]}</span></div></button><button className="garment-edit icon-button" aria-label={`Edit ${g.name}`} disabled={busy} onClick={() => setDialog({ garment: g, category: g.category })}><Icon name="more" size={19} /></button></article>)}<button className="add-card" disabled={storageFailed || busy} onClick={() => setDialog({ category: filter === "all" ? "top" : filter })}><span><Icon name="plus" size={23} /></span>Add a piece</button>{visible.length === 0 && <p className="no-results">{search ? "No pieces match your search." : `No ${filter === "all" ? "pieces" : labels[filter].toLowerCase()} yet. Add your first one.`}</p>}</div>}
          <div className="wardrobe-footer"><Icon name="shield" size={18} /><span>Stored on this device <span className="dot-divider">·</span> {formatBytes(usedBytes)} used</span></div>
          <p className="storage-note">Your wardrobe stays in this browser. Clearing site data removes your pieces.</p>
          <aside className="tip"><span className="tip-number">01 /</span><div><strong>A good photo goes a long way.</strong><p>Lay your piece flat on a plain, contrasting background. Keep the whole garment in the frame.</p></div></aside>
        </section>
        <section ref={board} className="outfit-panel" aria-labelledby="outfit-title">
          <div className="section-heading"><div className="title-line"><h2 id="outfit-title">The outfit board</h2><span className="live-badge">LIVE</span></div><button className="text-button reset" disabled={!selectedCount || busy} onClick={() => { setSelection({}); invalidate(); }}>Reset</button></div>
          <div className="board-tabs"><button className={view === "collage" ? "active" : ""} onClick={() => setView("collage")}><Icon name="grid" size={15} /> Flat lay</button><button className={view === "ai" ? "active" : ""} disabled={!result} onClick={() => setView("ai")}><Icon name="sparkles" size={16} /> AI preview</button><span>{selectedCount} {selectedCount === 1 ? "piece" : "pieces"}</span></div>
          <div className={`outfit-canvas ${pieces.outerwear ? "with-outerwear" : ""} ${view === "ai" ? "ai-canvas" : ""}`}>
            {view === "ai" && resultUrl ? <img className="ai-result" src={resultUrl} alt={`Generated outfit on a ${presentation} model`} /> : <>{(["top", "bottom", "shoes"] as const).map(c => <button key={c} className={`board-slot slot-${c} ${pieces[c] ? "filled" : ""}`} disabled={busy} aria-label={pieces[c] ? `Remove ${singular[c].toLowerCase()} from outfit` : `Choose ${singular[c].toLowerCase()}`} onClick={() => { if (pieces[c]) choose(c); else { setFilter(c); document.getElementById("wardrobe-title")?.scrollIntoView({ behavior: "smooth", block: "start" }); } }}>{pieces[c] ? <><img src={pieces[c]!.src} alt={pieces[c]!.name} /><span className="slot-remove"><Icon name="close" size={13} /></span></> : <><Icon name={c} size={c === "shoes" ? 37 : 46} /><span>Choose {c === "shoes" ? "shoes" : `a ${c}`}</span></>}</button>)}{pieces.outerwear && <button className="board-slot slot-outerwear filled" disabled={busy} aria-label="Remove outerwear from outfit" onClick={() => choose("outerwear")}><img src={pieces.outerwear.src} alt={pieces.outerwear.name} /><span className="slot-remove"><Icon name="close" size={13} /></span></button>}<div className="canvas-caption"><span />{selectedCount ? "A little mix. A little match. All you." : "Build something that feels like you."}<span /></div></>}
            {busy && <div className="generation-overlay" role="status"><span className="loader" /><strong>Putting your look together…</strong><p>You may be in the free AI queue.<br />Your pieces are safely on the board.</p></div>}
          </div>
          <div className="outfit-controls"><div className="requirements">{categories.map(c => <span key={c} className={pieces[c] ? "complete" : ""}><span className="require-dot">{pieces[c] ? <Icon name="check" size={10} /> : null}</span>{singular[c]}{c === "outerwear" && <small>optional</small>}</span>)}</div>
            <div className="model-row"><span>Model presentation</span><div className="segmented" aria-label="Model presentation">{(["masculine", "feminine"] as const).map(p => <button key={p} className={presentation === p ? "active" : ""} aria-pressed={presentation === p} disabled={busy} onClick={() => { if (presentation !== p) { setPresentation(p); invalidate(); } }}>{p === "masculine" ? "Masculine" : "Feminine"}</button>)}</div></div>
            <button className="primary generate" disabled={!!block || checking} onClick={generate}><Icon name="sparkles" size={18} />{busy ? "Generating outfit…" : "Generate outfit"}<Icon name="arrow" size={18} /></button>
            <p className="generation-note" aria-live="polite">{checking ? "Checking free AI availability…" : block || "Your selected photos will be sent to the connected AI service. Free queues may take a few minutes."}</p>
            {!available && !checking && <button className="text-button recheck" disabled={busy} onClick={checkAI}>Check AI availability again</button>}
            <button className="download-button" disabled={!selectedCount || downloading || busy} onClick={download}><Icon name="download" size={16} />{downloading ? "Preparing download…" : view === "ai" ? "Download AI preview" : "Download flat lay"}</button>
          </div>
        </section>
      </div>
      <footer className="site-footer"><span>Made for your wardrobe. And your next adventure.</span><span>Less guessing. More getting dressed.</span></footer>
    </main>
    <button className="mobile-board-jump" onClick={() => board.current?.scrollIntoView({ behavior: "smooth" })}><Icon name="grid" size={18} /> Your outfit <span>{requiredCount}/3</span><Icon name="arrow" size={18} /></button>
    {dialog && <GarmentDialog {...dialog} onClose={() => setDialog(null)} onSave={save} onDelete={remove} />}
    {exportBlob && <ExportDialog blob={exportBlob} onClose={() => setExportBlob(null)} />}
  </>;
}

