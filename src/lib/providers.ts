// Gradio HTTP adapters. No browser credentials, no paid provider.
// Self-contained on purpose: the Node test suite transpiles this file on its own.
export class ProviderError extends Error {
  constructor(message: string, public status = 503, public retryAfter = 3600) { super(message); }
}

export function providerFailure(message: string) {
  if (/quota|rate.limit|gpu.*limit|exceeded.*limit/i.test(message)) {
    const hours = /(\d+(?:\.\d+)?)\s*(?:hours?|h)\b/i.exec(message);
    const minutes = /(\d+(?:\.\d+)?)\s*(?:minutes?|min|m)\b/i.exec(message);
    const seconds = /(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s)\b/i.exec(message);
    const duration = Number(hours?.[1] || 0) * 3600 + Number(minutes?.[1] || 0) * 60 + Number(seconds?.[1] || 0);
    return new ProviderError("The free AI allowance is used up. Your collage is still available.", 429, Math.min(86400, Math.max(60, duration || 3600)));
  }
  return new ProviderError("The AI service could not finish this outfit. Your collage is still available.");
}

export function parseEvent(event: string): { event: string; data: unknown } | null {
  const lines = event.replace(/\r/g, "").split("\n");
  const type = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
  const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
  if (!type || !data) return null;
  try { return { event: type, data: JSON.parse(data) }; }
  catch { throw new ProviderError("The AI service returned an invalid response."); }
}

export async function readResult(response: Response): Promise<unknown> {
  if (!response.body) throw new ProviderError("The AI service returned no result.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r/g, "");
      if (buffer.length > 1_000_000) throw new ProviderError("The AI response was too large.");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1 || (done && buffer.length > 0)) {
        if (boundary === -1) boundary = buffer.length;
        const event = parseEvent(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
        // A hosted Space that hides tracebacks reports failures as `event: error, data: null`.
        if (event?.event === "error") {
          if (event.data === null) throw new ProviderError("The free AI service refused this request. It usually means the shared GPU allowance is used up, or the access token is missing or invalid.", 429, 300);
          throw providerFailure(typeof event.data === "string" ? event.data : JSON.stringify(event.data));
        }
        if (event?.event === "complete") return event.data;
      }
      if (done) throw new ProviderError("The AI connection ended before the preview was ready.");
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function requester(token: string | undefined, signal: AbortSignal) {
  return async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers, signal, redirect: "error" });
    if (!response.ok) {
      if (response.status === 429) throw new ProviderError("The free AI allowance is used up. Your collage is still available.", 429, Number(response.headers.get("retry-after")) || 3600);
      if (response.status === 401 || response.status === 403) throw new ProviderError("The free AI service rejected the access token. Check that HF_TOKEN is a valid Hugging Face token.", 503);
      throw providerFailure(await response.text());
    }
    return response;
  };
}

type GradioRequest = ReturnType<typeof requester>;

async function upload(request: GradioRequest, api: string, images: Blob[], names: string[]) {
  const form = new FormData();
  images.forEach((image, i) => form.append("files", image, names[i]));
  const paths: unknown = await (await request(`${api}/upload`, { method: "POST", body: form })).json();
  if (!Array.isArray(paths) || paths.length !== images.length || paths.some(p => typeof p !== "string")) throw new ProviderError("The AI service could not receive your clothing photos.");
  return paths as string[];
}

async function queue(request: GradioRequest, api: string, endpoint: string, data: unknown[]) {
  const queued = await (await request(`${api}/call/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) })).json();
  if (typeof queued.event_id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(queued.event_id)) throw new ProviderError("The AI service could not queue this outfit.");
  return readResult(await request(`${api}/call/${endpoint}/${queued.event_id}`));
}

async function download(request: GradioRequest, base: string, url: string) {
  const root = new URL(base);
  const resultUrl = new URL(url, base);
  if (resultUrl.origin !== root.origin || !resultUrl.pathname.startsWith(`${root.pathname.replace(/\/$/, "")}/gradio_api/file=`)) throw new ProviderError("The AI service returned an unexpected image location.");
  const response = await request(resultUrl.href);
  const type = response.headers.get("content-type")?.split(";")[0];
  if (!type || !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new ProviderError("The AI service returned an invalid image.");
  if (Number(response.headers.get("content-length")) > 15_000_000) throw new ProviderError("The AI preview is too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("The AI preview is empty.");
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 15_000_000) throw new ProviderError("The AI preview is too large.");
      chunks.push(new Uint8Array(chunk.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new ProviderError("The AI preview is empty.");
  return new Blob(chunks, { type });
}

// Self-hosted endpoint from ai-space/outfit_api.py: reference model, top, bottom, shoes.
export async function runFastFit(base: string, images: Blob[], signal: AbortSignal): Promise<Blob> {
  const root = base.replace(/\/$/, "");
  const api = `${root}/gradio_api`;
  const request = requester(undefined, signal);
  const paths = await upload(request, api, images, images.map((_, i) => i === 0 ? "model.png" : `garment-${i}.webp`));
  const data = await queue(request, api, "try_on", paths.map(path => ({ path, meta: { _type: "gradio.FileData" } })));
  if (!Array.isArray(data) || !data[0] || typeof data[0].url !== "string") throw new ProviderError("The AI service did not return an outfit image.");
  return download(request, root, data[0].url);
}

export const outfitPrompt = [
  "Picture 1 is a person. Picture 2 is a top, picture 3 is a bottom, picture 4 is a pair of shoes.",
  "Dress the person from picture 1 in exactly those three garments.",
  "Keep the face, hair, skin tone, body shape and standing pose of picture 1 unchanged.",
  "Reproduce the colour, pattern, texture, length and cut of each garment exactly as shown.",
  "Full body from head to feet with both shoes fully visible, plain light grey studio backdrop,",
  "soft even lighting, sharp photorealistic fashion photograph.",
].join(" ");

// Qwen-Image-Edit Space (`/infer`). Free, but ZeroGPU only grants a workable
// allowance to authenticated callers, so `token` is a free Hugging Face token.
export async function runQwenEdit(base: string, images: Blob[], token: string | undefined, signal: AbortSignal): Promise<Blob> {
  const root = base.replace(/\/$/, "");
  const api = `${root}/gradio_api`;
  const request = requester(token, signal);
  const paths = await upload(request, api, images, images.map((_, i) => i === 0 ? "model.png" : `garment-${i}.webp`));
  const gallery = paths.map(path => ({ image: { path, meta: { _type: "gradio.FileData" } } }));
  // Tuned for the 4-step Lightning Space: guidance 1.0, and height/width of 256
  // is the Space's sentinel for "size the output from the input images".
  // `rewrite_prompt` stays false; it routes the instruction through a separate
  // text model that the Space's own operator has to pay for.
  const data = await queue(request, api, "infer", [gallery, outfitPrompt, 42, false, 1, 4, 256, 256, false]);
  const result = Array.isArray(data) && Array.isArray(data[0]) ? data[0][0] : undefined;
  const image = result?.image ?? {};
  const url = typeof image.url === "string" ? image.url : typeof image.path === "string" ? `${root}/gradio_api/file=${image.path}` : null;
  if (!url) throw new ProviderError("The AI service did not return an outfit image.");
  return download(request, root, url);
}
