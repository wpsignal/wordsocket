/*
 * A dot on the favicon while something waits, drawn on a canvas copy of the site's icon; skipped
 * without an icon or with a cross-origin one. Badges are counted, so the href is restored only
 * when the last of several waiting moments clears.
 */

let original: { link: HTMLLinkElement; href: string } | null = null;
let holders = 0;

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
}

export function badgeFavicon(color = "#d63638"): Promise<boolean> {
  const link = iconLink();
  if (!link) return Promise.resolve(false);
  holders += 1;
  if (original) return Promise.resolve(true);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(false);
        ctx.drawImage(image, 0, 0, size, size);
        ctx.beginPath();
        ctx.arc(size - 7, 7, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        original = { link, href: link.href };
        link.href = canvas.toDataURL("image/png");
        resolve(true);
      } catch {
        holders = Math.max(0, holders - 1);
        resolve(false); // tainted canvas: an icon from another origin
      }
    };
    image.onerror = () => {
      holders = Math.max(0, holders - 1);
      resolve(false);
    };
    image.src = link.href;
  });
}

export function clearFavicon(): void {
  holders = Math.max(0, holders - 1);
  if (holders > 0 || !original) return;
  original.link.href = original.href;
  original = null;
}
