// Images next to the document are shown through the webview's resource host (the `linkBase` the host
// hands over). VS Code writes those addresses with the authority percent-encoded
// ("https://file%2B.vscode-resource.vscode-cdn.net/..."), while the URL parser normalises it to
// "file+". So the raw `src` attribute and the base never match as plain strings; compare parsed URLs.

/** True when `src` is served by the same webview resource host as `base` (the document's linkBase). */
export function isLocalResource(src: string, base: string): boolean {
  if (!src || !base) {
    return false;
  }
  try {
    const b = new URL(base);
    const u = new URL(src, b);
    if (b.origin !== 'null') {
      return u.origin === b.origin;
    }
    // Opaque origins (custom schemes): fall back to a prefix match on the parsed form.
    return u.href.startsWith(b.href);
  } catch {
    return src.startsWith(base);
  }
}

/** True for an image address that would be loaded from the internet (not data:, not a local resource). */
export function isRemoteImage(src: string, base: string): boolean {
  return /^https?:/i.test(src) && !isLocalResource(src, base);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the image'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Replaces local image addresses in `html` with data: URLs, so the page can be printed outside the
 * webview (the webview resource host only exists inside it). Images that cannot be read keep their
 * address; remote images are left alone.
 */
export async function inlineLocalImages(html: string, base: string): Promise<string> {
  if (!base) {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img')).filter((img) => isLocalResource(img.getAttribute('src') ?? '', base));
  if (imgs.length === 0) {
    return html;
  }
  const cache = new Map<string, Promise<string | undefined>>();
  const load = (src: string): Promise<string | undefined> => {
    const url = new URL(src, base).href;
    let p = cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((res) => (res.ok ? res.blob() : undefined))
        .then((blob) => (blob ? blobToDataUrl(blob) : undefined))
        .catch(() => undefined);
      cache.set(url, p);
    }
    return p;
  };
  await Promise.all(
    imgs.map(async (img) => {
      const data = await load(img.getAttribute('src') ?? '');
      if (data) {
        img.setAttribute('src', data);
      }
    }),
  );
  return doc.body.innerHTML;
}
