/// <reference lib="webworker" />
// Prefetch worker: warms next-episode manifests + first 2-3 heads into Cache API
// Triggered by watch-player when absolutePosition/duration > 0.8 or end-credits.
// Never auto-POST /transcode/start for N+1 — only manifests + direct-file heads.

export interface PrefetchRequest {
  type: 'prefetch';
  // next episode identifiers
  provider: string;
  id: string;
  season: number;
  episode: number;
  // already-known base for relative resolves: current streams? not needed; we fetch via /api/mb
  // play_url of next episode is resolved server-side; client sends the playUrl after streams+play
  playUrl?: string;
  manifestUrls?: string[];
  segmentUrls?: string[];
}

export interface PrefetchHoverRequest {
  type: 'hover';
  manifestUrls: string[];
}

type InMsg = PrefetchRequest | PrefetchHoverRequest;

const CACHE_NAME = 'prefetch-v1';
const MAX_CACHED = 64;

async function cachePut(url: string, priority: 'high' | 'low' = 'low') {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length > MAX_CACHED) {
      await cache.delete(keys[0]);
    }
    const resp = await fetch(url, { cache: 'no-store', priority } as unknown as RequestInit);
    if (!resp.ok) return;
    // Clone before storing so we can age-check transparently
    await cache.put(url, resp.clone());
  } catch {}
}

async function warmManifests(urls: string[]) {
  for (const u of urls.slice(0, 6)) {
    await cachePut(u, 'low');
    // Light secondary warm: fetch first 2-3 segments referenced by manifest
    // Without parsing manifest fully here, we limit to heads (above already handles segments passed explicitly)
  }
}

async function warmSegments(urls: string[]) {
  for (const u of urls.slice(0, 3)) {
    await cachePut(u, 'low');
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'prefetch') {
      const urls: string[] = [];
      if (msg.manifestUrls) urls.push(...msg.manifestUrls);
      if (msg.playUrl) urls.push(msg.playUrl);
      if (urls.length) await warmManifests(urls);
      if (msg.segmentUrls && msg.segmentUrls.length) {
        await warmSegments(msg.segmentUrls);
      }
      (self as unknown as { postMessage: (d: unknown) => void }).postMessage({ ok: true, type: 'prefetch' });
    } else if (msg.type === 'hover') {
      if (msg.manifestUrls.length) await warmManifests(msg.manifestUrls);
      (self as unknown as { postMessage: (d: unknown) => void }).postMessage({ ok: true, type: 'hover' });
    }
  } catch (err) {
    try {
      (self as unknown as { postMessage: (d: unknown) => void }).postMessage({ ok: false, error: String(err) });
    } catch {}
  }
};

export {};
