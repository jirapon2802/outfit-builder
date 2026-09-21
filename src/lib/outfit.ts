export const categories = ["top", "bottom", "shoes", "outerwear"] as const;
export type Category = (typeof categories)[number];
export type Presentation = "masculine" | "feminine";
export type Selection = Partial<Record<Category, string>>;
export const labels: Record<Category, string> = {
  top: "Tops", bottom: "Bottoms", shoes: "Shoes", outerwear: "Outerwear",
};
export const singular: Record<Category, string> = {
  top: "Top", bottom: "Bottom", shoes: "Shoes", outerwear: "Outerwear",
};
export type Garment = {
  id: string;
  name: string;
  category: Category;
  original: Blob;
  cutout?: Blob;
  useCutout: boolean;
  createdAt: number;
};
export type DisplayGarment = Garment & { src: string };

export function generationBlock(selection: Selection, available: boolean, busy = false, limited = false) {
  if (selection.outerwear) return "Outerwear is on your board. AI preview is off; your collage is ready.";
  if (!selection.top || !selection.bottom || !selection.shoes) return "Select a top, bottom, and shoes to complete your outfit.";
  if (busy) return "Creating your outfit. Free AI queues can take a few minutes.";
  if (limited) return "The free AI limit has been reached. Keep creating with your collage.";
  if (!available) return "AI preview is not connected yet. Your collage is always available.";
  return null;
}

export function restoreSelection(selection: Selection, garments: Garment[]): Selection {
  return Object.fromEntries(categories.filter(category => garments.some(g => g.id === selection[category] && g.category === category)).map(category => [category, selection[category]]));
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(0, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
