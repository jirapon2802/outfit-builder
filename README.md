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

## AI status: two free routes wired up; the model has been shown to do the job

The wardrobe and collage run without configuration. Neither AI route uses a paid provider.

### Option 1: shared Qwen-Image-Edit Space (no GPU of your own, no setup)

Qwen-Image-Edit-2511 Spaces publish a free Gradio `/infer` endpoint that edits a set of uploaded images from a text instruction. The app sends four images (bundled reference model, top, bottom, shoes) and an outfit instruction, so garment photos are uploaded directly and never need to be publicly hosted. This route is on by default; no configuration is required.

Setting `HF_TOKEN` in `.env.local` to a free Hugging Face read token is strongly recommended. Without it, requests draw on a small per-IP ZeroGPU allowance that is frequently already spent. Override the Space with `IMAGE_EDIT_URL` if you prefer a different one with the same `/infer` signature.

Verified on 2026-09-21 by driving live Spaces with real garment photos:

- The model does the job. Given a full-body photo plus a black t-shirt, a pair of distressed blue jeans, and white sneakers, it produced a photorealistic full-body image wearing all three, preserving the person's face, hair, tattoos and pose, and reproducing the shirt's chest logo and the jeans' distressing. That run took roughly 85 seconds on a 4-step Space.
- **Choice of Space matters more than the model.** ZeroGPU compares the *requested* `@spaces.GPU(duration=...)` against remaining quota, not the actual runtime. The official `Qwen/Qwen-Image-Edit-2511` Space requests 180 seconds and is therefore refused outright on a free allowance, about 300 ms after queueing, with `event: error, data: null` — the same symptom recorded here earlier, and it happens in that Space's own web UI too, not just over the API. The default Space configured here asks for the 60-second default and fits.
- The free allowance is small and per-IP. Two successful anonymous generations exhausted it; subsequent calls failed in about one second.

What is still unverified: no run has gone through this project's own `/api/try-on` route end to end, because the development environment had no working shell to start Next.js. The adapter sends a payload shape that the live Space accepts (upload and queue both return 200), but latency and output through the app's own bundled model images are unmeasured.

### Option 2: your own FastFit endpoint

`ai-space/outfit_api.py` implements a Gradio 5+ `/try_on` endpoint accepting four images (reference person, top, bottom, shoes) and returning one PNG, wrapping the official FastFit engine. `FASTFIT_URL` takes precedence over `HF_TOKEN` when both are set.

1. In a separate environment, clone [official FastFit](https://github.com/Zheng-Chong/FastFit), follow its dependency/GPU instructions, and copy `ai-space/outfit_api.py` alongside its `app.py`. The adapter has not been GPU-tested; resolve upstream dependency compatibility in that environment before exposing the service.
2. Run with Gradio 5+ using `python outfit_api.py`. For a Hugging Face Gradio Space, set `app_file: outfit_api.py`. If using ZeroGPU, install `spaces`, select ZeroGPU hardware, and set `USE_ZEROGPU=1`. Validate the endpoint directly with all four reference inputs.
3. Copy `.env.example` to `.env.local`, set `FASTFIT_URL`, and restart Next.js.
4. Test one complete outfit on each presentation. Check that shoes are visible, all pieces are respected, and provider quota failures return to the collage.

On 2026-09-21 the official FastFit demo timed out, one public Hugging Face copy reported a runtime error, and another was sleeping on CPU hardware, so this route needs a deployment you control. FastFit has a noncommercial license; review it before expanding beyond personal use.

### Options that were ruled out

- **Kolors-Virtual-Try-On** and similar purpose-built try-on Spaces: the most popular one serves `{"named_endpoints":{},"unnamed_endpoints":{}}`, meaning its API is switched off, and most of the remaining try-on Spaces sit in `RUNTIME_ERROR` or proxy a commercial backend. A general image-editing model turned out to handle the task better than the dedicated try-on Spaces that were still reachable.
- **Spaces that force a style LoRA**: `prithivMLmods/Qwen-Image-Edit-2511-LoRAs-Fast` works anonymously and is a useful fallback, but it always applies one of its style LoRAs. Its default, `Photo-to-Anime`, wrecks a try-on result; `Ultra-Realistic-Portrait` produced the good image described above.
- **Pollinations**: genuinely keyless, but the free tier is text-to-image only. Its `kontext` image-to-image mode requires inputs to be publicly fetchable URLs, which private wardrobe photos are not.
- **Gemini image models** and **Hugging Face Inference Providers**: image generation has no Gemini free tier, and HF free accounts get $0.10 of monthly credit, which is a trial rather than a free route.

Both routes share one HTTP client: Gradio's upload/call/SSE flow over native fetch, with request size limits, a timeout, same-origin result checks, a single in-flight request per Node process, and a quota cooldown. The automated adapter tests use a local simulated Gradio service; they cover the request and error handling, not generated-image quality or GPU compatibility.

[Hugging Face ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu) documents free hosting for eligible accounts and a limited daily GPU allowance. Expect queueing, and expect the daily allowance to run out.

Only the photos selected for an explicit Generate action, plus a bundled model reference, are sent to the connected service. Its upload/cache policy applies: `ai-space/outfit_api.py` expires cached files after one hour, but a third-party Space is outside your control, so do not send wardrobe photos you would not hand to its operator. The site is a personal prototype: add authentication and a durable shared rate limiter before making the inference route publicly accessible. A serverless host must support the configured long-running requests. Do not assume the in-memory lock provides multi-instance protection.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The Node test suite covers outfit gating, stale selection recovery, background removal safeguards, fragmented SSE, quota retry timing, image upload/queue/retrieval, both provider payload shapes, and rejection of cross-origin result URLs. `tests/fixtures/` contains synthetic, explicitly named test garments for browser checks; they are not preloaded into the product.

## Model assets

`public/models/masculine.png` and `public/models/feminine.png` were generated once with the built-in image-generation tool, not a paid runtime API. They depict fictional adult people in a fixed front-facing pose. They are reusable inference references, not sample try-on results. Their prompts are in `docs/model-prompts.md`.
