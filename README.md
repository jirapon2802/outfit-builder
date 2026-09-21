# Outfit Builder

A phone-friendly Next.js website for matching clothes you already own.

## Run locally

```sh
npm install
npm run dev -- --hostname 0.0.0.0
```

Open http://localhost:3000 on your computer. On a phone connected to the same Wi-Fi, open `http://<your-computer-LAN-IP>:3000` (Windows Firewall must allow the development server). Keep using the same URL: each browser/origin has its own local wardrobe. This is a website, not a native mobile app.

## Implemented

- Add a required garment photo, name it, and manually choose top, bottom, shoes, or outerwear.
- Resize photos to a maximum 1,000 pixels and encode as WebP. Save original and optional cleaned image as Blobs in IndexedDB, with storage size displayed. No wardrobe photos are stored on the web server.
- Attempt local, edge-connected plain-background removal once per upload. This is a conservative image-processing algorithm, not semantic AI segmentation. Complex backgrounds remain intact. Users can switch back to the original and replace the photo.
- Search/filter, edit, delete with an in-app confirmation, and reuse pieces.
- Assemble a live flat lay and export a 1,000 × 1,300 PNG, with a save link, native sharing where supported, and a press-and-hold fallback for phone browsers. Keep selections and model presentation on reload.
- Require top, bottom, and shoes for AI. Selecting outerwear blocks AI on both the client and the server.
- Choose a consistent masculine or feminine synthetic model. Invalidate old AI results whenever the outfit or presentation changes. Generated results exist only in memory until downloaded.
- Handle unavailable services, queues, quota errors, and failures with the collage fallback. Never silently switch to a paid service.

Clearing browser data erases this local wardrobe; there is no account, sync, cloud backup, or preview gallery. The app itself needs the web server; offline installation/service-worker support is not included.

## AI status: integration implemented; live generation not yet validated

The wardrobe and collage run without configuration. AI remains visibly unavailable until a compatible endpoint is connected.

On 2026-09-21, the official FastFit demo timed out, one public Hugging Face copy reported a runtime error, and another was sleeping on CPU hardware. As an alternative, the official Qwen/Qwen-Image-Edit Space accepted a synthetic reference-board upload and queued a free API request, but returned `event: error, data: null` without an image. No successful free inference route was verified. The automated adapter tests use a local simulated Gradio service; they do not establish generated-image quality or GPU compatibility.

The service contract is implemented by `ai-space/outfit_api.py`: a Gradio 5+ `/try_on` endpoint accepting four images (reference person, top, bottom, shoes) and returning one PNG. It wraps the official FastFit engine. The website uses Gradio's upload/call/SSE HTTP flow with native fetch, request size limits, timeout, same-origin checks, a single in-flight request per Node process, and quota cooldown. No API key or paid provider is required or configured.

To connect a working endpoint:

1. In a separate environment, clone [official FastFit](https://github.com/Zheng-Chong/FastFit), follow its dependency/GPU instructions, and copy `ai-space/outfit_api.py` alongside its `app.py`. The adapter has not been GPU-tested; resolve upstream dependency compatibility in that environment before exposing the service.
2. Run with Gradio 5+ using `python outfit_api.py`. For a Hugging Face Gradio Space, set `app_file: outfit_api.py`. If using ZeroGPU, install `spaces`, select ZeroGPU hardware, and set `USE_ZEROGPU=1`. Validate the endpoint directly with all four reference inputs.
3. Copy `.env.example` to `.env.local`, set `FASTFIT_URL` to the compatible service URL, and restart Next.js. The health check requires the named `try_on` endpoint.
4. Test one complete outfit on each presentation. Check that shoes are visible, all pieces are respected, and provider quota failures return to the collage.

[Hugging Face ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu) currently documents free hosting for eligible accounts and a limited daily GPU allowance. Free availability, queuing, and compatibility must be verified for the actual deployment. FastFit has a noncommercial license; review it before expanding beyond personal use.

Only the photos selected for an explicit Generate action, plus a bundled model reference, are sent to the connected service. Its upload/cache policy applies. The provided wrapper expires cached files after one hour. The site is a personal prototype: add authentication and a durable shared rate limiter before making the inference route publicly accessible. A serverless host must support the configured long-running requests. Do not assume the in-memory lock provides multi-instance protection.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The Node test suite covers outfit gating, stale selection recovery, background removal safeguards, fragmented SSE, quota retry timing, image upload/queue/retrieval, and rejection of cross-origin result URLs. `tests/fixtures/` contains synthetic, explicitly named test garments for browser checks; they are not preloaded into the product.

## Model assets

`public/models/masculine.png` and `public/models/feminine.png` were generated once with the built-in image-generation tool, not a paid runtime API. They depict fictional adult people in a fixed front-facing pose. They are reusable inference references, not sample try-on results. Their prompts are in `docs/model-prompts.md`.
