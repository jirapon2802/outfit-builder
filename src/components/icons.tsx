import type { Category } from "@/lib/outfit";

export function Icon({ name, size = 22, ...props }: { name: Category | "hanger" | "plus" | "close" | "check" | "download" | "sparkles" | "arrow" | "grid" | "shield" | "photo" | "more" | "trash"; size?: number } & React.SVGProps<SVGSVGElement>) {
  const paths: Record<typeof name, React.ReactNode> = {
    hanger: <><path d="M9 6a3 3 0 0 1 6 0c0 1.5-3 2-3 4v1"/><path d="m12 11 9 6a1 1 0 0 1-.6 2H3.6a1 1 0 0 1-.6-2z"/></>,
    top: <path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c-1 3-7 3-8 0Z"/>,
    bottom: <><path d="M6 3h12l2 18h-7l-1-11-1 11H4Z"/><path d="M6 7h12M12 3v4"/></>,
    shoes: <><path d="m3 8 5 3 5-2 2 5 6 3v4H3Z"/><path d="M3 17h11M11 11l3 1M12 14l3 1"/></>,
    outerwear: <><path d="m8 3-4 3-3 12 4 1 2-8v10h10V11l2 8 4-1-3-12-4-3-4 3Z"/><path d="m8 3 4 7 4-7M12 10v11"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M20 2v4m-2-2h4"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    photo: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 5 5 3-3 4 4"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
