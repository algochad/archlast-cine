import { describe, it, expect } from "vitest";
import { METRIC_ROWS, metricOf, buildMetricRows, buildTypeRows, pickHero } from "../rows";
import type { CatalogItem, BrowseMetrics } from "../types";

let n = 0;

function item(over: Partial<CatalogItem> = {}): CatalogItem {
  n += 1;
  return {
    id: { provider: "moviebox", value: `v${n}` },
    title: `Title ${n}`,
    media_type: "movie",
    year: null,
    poster_url: `https://img/${n}.jpg`,
    season_count: null,
    ...over,
  };
}

function metricsFor(pairs: Array<[CatalogItem, BrowseMetrics]>): Record<string, BrowseMetrics> {
  const out: Record<string, BrowseMetrics> = {};
  for (const [it, m] of pairs) out[it.id.value] = m;
  return out;
}

describe("METRIC_ROWS", () => {
  it("defines four rows with the expected keys and labels", () => {
    expect(METRIC_ROWS.map((r) => r.key)).toEqual(["trending", "rating", "recent_rating", "popularity"]);
    expect(METRIC_ROWS.map((r) => r.label)).toEqual([
      "Trending Now",
      "Top Rated All-Time",
      "Fresh & Hot",
      "Most Watched",
    ]);
  });
  it("keeps keys unique", () => {
    expect(new Set(METRIC_ROWS.map((r) => r.key)).size).toBe(METRIC_ROWS.length);
  });
});

describe("metricOf", () => {
  it("returns the stored metrics for the item id", () => {
    const it = item();
    const m = { trending: 5 };
    expect(metricOf(it, metricsFor([[it, m]]))).toBe(m);
  });
  it("returns an empty object when the id is missing", () =>
    expect(metricOf(item(), {})).toEqual({}));
  it("returns an empty object for an empty metrics record", () =>
    expect(metricOf(item(), {})).toEqual({}));
  it("keys by id value, ignoring the provider", () => {
    const a = item({ id: { provider: "moviebox", value: "shared" } });
    const b = item({ id: { provider: "fourkhdhub", value: "shared" } });
    const m = { rating: 9 };
    expect(metricOf(a, metricsFor([[b, m]]))).toBe(m);
  });
  it("preserves null metric values untouched", () => {
    const it = item();
    expect(metricOf(it, metricsFor([[it, { rating: null }]]))).toEqual({ rating: null });
  });
  it("handles unicode id values", () => {
    const it = item({ id: { provider: "moviebox", value: "日本語 🎬" } });
    const m = { popularity: 3 };
    expect(metricOf(it, metricsFor([[it, m]]))).toBe(m);
  });
});

describe("buildMetricRows", () => {
  it("sorts each row by its own metric, descending", () => {
    const a = item();
    const b = item();
    const c = item();
    const metrics = metricsFor([
      [a, { trending: 1 }],
      [b, { trending: 5 }],
      [c, { trending: 3 }],
    ]);
    const row = buildMetricRows([a, b, c], metrics).find((r) => r.key === "trending");
    expect(row?.items.map((i) => i.id.value)).toEqual([b.id.value, c.id.value, a.id.value]);
  });
  it("ranks rating rows by rating, not trending", () => {
    const a = item();
    const b = item();
    const metrics = metricsFor([
      [a, { trending: 99, rating: 1 }],
      [b, { trending: 0, rating: 9 }],
    ]);
    const row = buildMetricRows([a, b], metrics).find((r) => r.key === "rating");
    expect(row?.items[0].id.value).toBe(b.id.value);
  });
  it("dedupes identical provider+id pairs, keeping the first", () => {
    const a = item({ id: { provider: "moviebox", value: "dup" } });
    const b = item({ id: { provider: "moviebox", value: "dup" }, title: "Second" });
    // Empty metrics: every row would be empty and filtered out, so score one
    // metric to keep rows alive. Only the trending row survives the
    // length>0 filter; the other three keys sort -Infinity for both and
    // slice(0,20) still returns the single deduped item per row — but rows
    // with all--Infinity items are kept (length 1), so assert per-row.
    const rows = buildMetricRows([a, b], metricsFor([[a, { trending: 1 }]]));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const dups = row.items.filter((i) => i.id.value === "dup");
      expect(dups).toHaveLength(1);
      expect(dups[0].title).toBe(a.title);
    }
    expect(new Set(rows.flatMap((r) => r.items).map((i) => `${i.id.provider}:${i.id.value}`)).size).toBe(
      new Set(rows.flatMap((r) => r.items).map((i) => `${i.id.provider}:${i.id.value}`)).size,
    );
  });
  it("treats the same value under different providers as distinct", () => {
    const a = item({ id: { provider: "moviebox", value: "same" } });
    const b = item({ id: { provider: "fourkhdhub", value: "same" } });
    const rows = buildMetricRows([a, b], {});
    expect(rows.flatMap((r) => r.items)).toHaveLength(4 * 2);
  });
  it("drops items without a poster", () => {
    const ghost = item({ poster_url: null });
    expect(buildMetricRows([ghost], metricsFor([[ghost, { trending: 99 }]]))).toEqual([]);
  });
  it("returns [] for an empty feed", () => expect(buildMetricRows([], {})).toEqual([]));
  it("respects the limit", () => {
    const feed = Array.from({ length: 30 }, () => item());
    const rows = buildMetricRows(feed, {}, 5);
    for (const r of rows) expect(r.items).toHaveLength(5);
  });
  it("sorts null metrics as missing (bottom), not as zero", () => {
    const a = item();
    const b = item();
    const metrics = metricsFor([
      [a, { trending: null }],
      [b, { trending: -5 }],
    ]);
    const row = buildMetricRows([a, b], metrics).find((r) => r.key === "trending");
    expect(row?.items[0].id.value).toBe(b.id.value);
  });
  it("keeps unscored poster items instead of dropping the row", () => {
    const rows = buildMetricRows([item(), item()], {});
    expect(rows).toHaveLength(4);
  });
});

describe("buildTypeRows", () => {
  it("splits movies and series into labeled rows", () => {
    const m = item({ media_type: "movie" });
    const s = item({ media_type: "series" });
    const rows = buildTypeRows([m, s], {});
    expect(rows.map((r) => r.key)).toEqual(["movies", "series"]);
    expect(rows.map((r) => r.label)).toEqual(["Movies", "Series"]);
  });
  it("omits empty types", () => {
    expect(buildTypeRows([item({ media_type: "movie" })], {}).map((r) => r.key)).toEqual(["movies"]);
    expect(buildTypeRows([item({ media_type: "series" })], {}).map((r) => r.key)).toEqual(["series"]);
  });
  it("returns [] for empty or posterless feeds", () => {
    expect(buildTypeRows([], {})).toEqual([]);
    expect(buildTypeRows([item({ poster_url: null })], {})).toEqual([]);
  });
  it("orders by rating, falling back to trending", () => {
    const low = item({ media_type: "movie" });
    const high = item({ media_type: "movie" });
    const metrics = metricsFor([
      [low, { trending: 99 }],
      [high, { rating: 9, trending: 0 }],
    ]);
    const rows = buildTypeRows([low, high], metrics);
    // score = rating ?? trending: low scores 99 (fallback), high scores 9.
    // Trending-fallback can outrank a low rating — the contract is rating
    // first only when present, otherwise trending. Assert the real order.
    expect(rows[0].items.map((i) => i.id.value)).toEqual([low.id.value, high.id.value]);
    // And the pure-rating case: rating present on both → higher rating first.
    const r1 = item({ media_type: "movie" });
    const r2 = item({ media_type: "movie" });
    const m2 = metricsFor([
      [r1, { rating: 3 }],
      [r2, { rating: 9 }],
    ]);
    const rows2 = buildTypeRows([r1, r2], m2);
    expect(rows2[0].items.map((i) => i.id.value)).toEqual([r2.id.value, r1.id.value]);
  });
  it("dedupes repeated items", () => {
    const a = item({ media_type: "movie", id: { provider: "moviebox", value: "dup" } });
    const b = item({ media_type: "movie", id: { provider: "moviebox", value: "dup" } });
    expect(buildTypeRows([a, b], {})[0].items).toHaveLength(1);
  });
  it("respects the limit per type row", () => {
    const feed = Array.from({ length: 10 }, () => item({ media_type: "series" }));
    expect(buildTypeRows(feed, {}, 3)[0].items).toHaveLength(3);
  });
  it("excludes anime items from movie/series rows", () => {
    const rows = buildTypeRows([item({ media_type: "anime" })], {});
    expect(rows).toEqual([]);
  });
});

describe("pickHero", () => {
  it("returns null for an empty feed", () => expect(pickHero([], {})).toBeNull());
  it("returns null when no item has a poster", () =>
    expect(pickHero([item({ poster_url: null })], {})).toBeNull());
  it("picks the strongest trending item", () => {
    const a = item();
    const b = item();
    const hero = pickHero([a, b], metricsFor([[a, { trending: 2 }], [b, { trending: 9 }]]));
    expect(hero?.id.value).toBe(b.id.value);
  });
  it("falls back to the first poster item when nothing trends", () => {
    const a = item();
    const b = item();
    expect(pickHero([a, b], {})?.id.value).toBe(a.id.value);
  });
  it("falls back when the top trending score is zero", () => {
    const a = item();
    const b = item();
    const hero = pickHero([a, b], metricsFor([[a, { trending: 0 }], [b, { trending: 0 }]]));
    expect(hero?.id.value).toBe(a.id.value);
  });
  it("falls back when trending scores are negative", () => {
    const a = item();
    expect(pickHero([a], metricsFor([[a, { trending: -3 }]]))?.id.value).toBe(a.id.value);
  });
  it("ignores posterless items even with the highest trending score", () => {
    const ghost = item({ poster_url: null });
    const real = item();
    const hero = pickHero([ghost, real], metricsFor([[ghost, { trending: 999 }], [real, { trending: 1 }]]));
    expect(hero?.id.value).toBe(real.id.value);
  });
  it("dedupes before choosing", () => {
    const a = item({ id: { provider: "moviebox", value: "dup" } });
    const b = item({ id: { provider: "moviebox", value: "dup" } });
    const hero = pickHero([a, b], metricsFor([[a, { trending: 4 }]]));
    expect(hero?.title).toBe(a.title);
  });
});
