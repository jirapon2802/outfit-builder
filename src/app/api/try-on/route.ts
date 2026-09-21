import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ProviderError, runFastFit } from "@/lib/fastfit";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
let running = false;
let limitedUntil = 0;

function baseUrl() {
  const value = process.env.FASTFIT_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.href.replace(/\/$/, "");
  } catch { return null; }
}

export async function GET() {
  const base = baseUrl();
  if (!base) return NextResponse.json({ available: false, reason: "not_configured" });
  try {
    const response = await fetch(`${base}/config`, { signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error" });
    const config = await response.json();
    const compatible = config.dependencies?.some((d: { api_name?: string }) => d.api_name === "try_on");
    return NextResponse.json({ available: response.ok && !!compatible, reason: compatible ? "connected" : "unavailable" });
  } catch { return NextResponse.json({ available: false, reason: "unavailable" }); }
}

export async function POST(request: NextRequest) {
  // This is a personal, single-server app. Do not expose its inference route as
  // a public service without authentication and a shared rate limiter.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: "Open Outfit Builder to generate an outfit." }, { status: 403 });
  const base = baseUrl();
  if (!base) return NextResponse.json({ error: "AI preview is not connected yet. Your collage is always available." }, { status: 503 });
  if (running) return NextResponse.json({ error: "An outfit is already generating. Please wait for it to finish." }, { status: 409 });
  if (Date.now() < limitedUntil) return NextResponse.json({ error: "The free AI allowance is used up. Use your collage for now.", retryAfter: Math.ceil((limitedUntil - Date.now()) / 1000) }, { status: 429 });
  const maxBytes = 8 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes) return NextResponse.json({ error: "These photos are too large. Please use smaller images." }, { status: 413 });
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return NextResponse.json({ error: "Upload clothing photos to generate an outfit." }, { status: 400 });
  running = true;
  try {
    // Bound the actual body too, including when content-length is absent.
    const reader = request.body?.getReader();
    if (!reader) throw new ProviderError("No clothing photos were provided.", 400);
    const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > maxBytes) throw new ProviderError("These photos are too large.", 413);
        chunks.push(new Uint8Array(chunk.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const form = await new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    if (form.has("outerwear")) throw new ProviderError("AI preview is disabled when outerwear is selected. Use the collage instead.", 400);
    const presentation = form.get("presentation");
    if (presentation !== "masculine" && presentation !== "feminine") throw new ProviderError("Choose a model presentation.", 400);
    const images: Blob[] = [];
    for (const key of ["top", "bottom", "shoes"]) {
      const image = form.get(key);
      if (!(image instanceof File) || !image.size || image.size > 2 * 1024 * 1024 || !["image/webp", "image/png", "image/jpeg"].includes(image.type)) throw new ProviderError("Select a top, bottom, and shoes using valid clothing photos (up to 2 MB each).", 400);
      const bytes = new Uint8Array(await image.slice(0, 12).arrayBuffer());
      const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
      if (!png && !jpg && !webp) throw new ProviderError("One of these files is not a supported photo.", 400);
      images.push(image);
    }
    const model = await readFile(path.join(process.cwd(), "public", "models", `${presentation}.png`));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(270000)]);
    const result = await runFastFit(base, [new Blob([model], { type: "image/png" }), ...images], signal);
    return new Response(result, { headers: { "content-type": result.type, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.status === 429) limitedUntil = Date.now() + Math.min(86400, Math.max(60, error.retryAfter)) * 1000;
      return NextResponse.json({ error: error.message, ...(error.status === 429 ? { retryAfter: error.retryAfter } : {}) }, { status: error.status });
    }
    return NextResponse.json({ error: "The AI service is unavailable or took too long. Your collage is still ready to use." }, { status: 503 });
  } finally { running = false; }
}
