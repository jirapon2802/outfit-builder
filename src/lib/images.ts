import type { Category, DisplayGarment } from "./outfit";

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This photo could not be opened. Try a JPG, PNG, or WebP image."));
    image.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, type = "image/webp", quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not prepare the photo.")), type, quality));
}

// Only remove a uniform background connected to the image edges. If confidence is
// low, preserve the original. No network/model download or AI credits are needed.
export function removePlainBackground(data: Uint8ClampedArray, width: number, height: number): boolean {
  const count = width * height;
  const corners = [0, width - 1, (height - 1) * width, count - 1];
  if (corners.some(p => data[p * 4 + 3] < 240)) return false;
  const color = [0, 1, 2].map(c => corners.reduce((sum, p) => sum + data[p * 4 + c], 0) / 4);
  if (corners.some(p => color.some((v, c) => Math.abs(data[p * 4 + c] - v) > 24))) return false;
  const visited = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let head = 0, tail = 0;
  const add = (p: number) => {
    if (visited[p]) return;
    visited[p] = 1;
    const distance = Math.hypot(...color.map((v, c) => data[p * 4 + c] - v));
    if (distance < 38) queue[tail++] = p;
  };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const p = queue[head++];
    if (p % width > 0) add(p - 1);
    if (p % width < width - 1) add(p + 1);
    if (p >= width) add(p - width);
    if (p < count - width) add(p + width);
  }
  if (tail < count * 0.04 || tail > count * 0.88) return false;
  for (let i = 0; i < tail; i++) data[queue[i] * 4 + 3] = 0;
  return true;
}

export async function preparePhoto(file: File): Promise<{ original: Blob; cutout?: Blob }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG, or WebP photo. Export HEIC photos as JPG first.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a photo smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.width * image.height > 60_000_000) throw new Error("This photo is too large. Resize it before adding it.");
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const original = await toBlob(canvas);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    if (!removePlainBackground(pixels.data, canvas.width, canvas.height)) return { original };
    context.putImageData(pixels, 0, 0);
    return { original, cutout: await toBlob(canvas) };
  } finally { URL.revokeObjectURL(url); }
}

export async function createCollage(pieces: Partial<Record<Category, DisplayGarment>>) {
  const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 1300;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f3f0e9"; ctx.fillRect(0, 0, 1000, 1300);
  ctx.fillStyle = "#343c30"; ctx.font = "28px Georgia"; ctx.fillText("outfit builder", 60, 65);
  const outerwear = !!pieces.outerwear;
  const boxes: Record<Category, number[]> = {
    top: [outerwear ? 40 : 210, 120, outerwear ? 450 : 580, 400],
    bottom: [outerwear ? 40 : 210, 545, outerwear ? 450 : 580, 470],
    shoes: [250, 1030, 500, 185],
    outerwear: [515, 200, 445, 760],
  };
  for (const [category, garment] of Object.entries(pieces)) {
    if (!garment) continue;
    const image = await loadImage(garment.src);
    const [x, y, w, h] = boxes[category as Category];
    const scale = Math.min(w / image.width, h / image.height);
    ctx.drawImage(image, x + (w - image.width * scale) / 2, y + (h - image.height * scale) / 2, image.width * scale, image.height * scale);
  }
  ctx.fillStyle = "#797d72"; ctx.font = "16px sans-serif"; ctx.fillText("YOUR CLOTHES. YOUR COMBINATIONS.", 60, 1260);
  return toBlob(canvas, "image/png");
}
