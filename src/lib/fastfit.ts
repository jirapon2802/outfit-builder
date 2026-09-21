// Small Gradio HTTP adapter for ai-space/outfit_api.py. No browser credentials.
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
        if (event?.event === "error") throw providerFailure(typeof event.data === "string" ? event.data : JSON.stringify(event.data));
        if (event?.event === "complete") return event.data;
      }
      if (done) throw new ProviderError("The AI connection ended before the preview was ready.");
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export async function runFastFit(base: string, images: Blob[], signal: AbortSignal): Promise<Blob> {
  const root = base.replace(/\/$/, "");
  const api = `${root}/gradio_api`;
  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, signal, redirect: "error" });
    if (!response.ok) {
      if (response.status === 429) throw new ProviderError("The free AI allowance is used up. Your collage is still available.", 429, Number(response.headers.get("retry-after")) || 3600);
      throw providerFailure(await response.text());
    }
    return response;
  }
  const form = new FormData();
  images.forEach((image, i) => form.append("files", image, i === 0 ? "model.png" : `garment-${i}.webp`));
  const paths: unknown = await (await request(`${api}/upload`, { method: "POST", body: form })).json();
  if (!Array.isArray(paths) || paths.length !== 4 || paths.some(p => typeof p !== "string")) throw new ProviderError("The AI service could not receive your clothing photos.");
  const queued = await (await request(`${api}/call/try_on`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: paths.map(path => ({ path, meta: { _type: "gradio.FileData" } })) }) })).json();
  if (typeof queued.event_id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(queued.event_id)) throw new ProviderError("The AI service could not queue this outfit.");
  const data = await readResult(await request(`${api}/call/try_on/${queued.event_id}`));
  if (!Array.isArray(data) || !data[0] || typeof data[0].url !== "string") throw new ProviderError("The AI service did not return an outfit image.");
  const resultUrl = new URL(data[0].url, root);
  if (resultUrl.origin !== new URL(root).origin || !resultUrl.pathname.startsWith(`${new URL(root).pathname.replace(/\/$/, "")}/gradio_api/file=`)) throw new ProviderError("The AI service returned an unexpected image location.");
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
