import { describe, it, expect, afterEach } from "vitest";
import {
  parseSubtitleCues,
  attachSubtitleTrack,
  reattachSubtitleTrack,
  ensureActiveCues,
  type SubtitleCue,
  type SubtitleTrackState,
} from "../captions";

describe("parseSubtitleCues", () => {
  it("returns [] for empty input", () => expect(parseSubtitleCues("")).toEqual([]));
  it("returns [] for whitespace-only and garbage input", () => {
    expect(parseSubtitleCues("   \n\n  ")).toEqual([]);
    expect(parseSubtitleCues("hello world, no cues here")).toEqual([]);
    expect(parseSubtitleCues("日本語テキスト 🎬")).toEqual([]);
  });
  it("parses a basic SRT block with a numeric sequence id", () => {
    const cues = parseSubtitleCues("1\n00:00:01,000 --> 00:00:04,000\nHello world\n");
    expect(cues).toEqual([{ start: 1, end: 4, text: "Hello world" }]);
  });
  it("parses WebVTT with a header line", () => {
    const src = "WEBVTT - Generated\n\n00:01.000 --> 00:04.000\nHi\n";
    expect(parseSubtitleCues(src)).toEqual([{ start: 1, end: 4, text: "Hi" }]);
  });
  it("strips a BOM and normalizes CRLF line endings", () => {
    const cues = parseSubtitleCues("\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n");
    expect(cues).toEqual([{ start: 1, end: 2, text: "Hi" }]);
  });
  it("supports hour-long timestamps and fractional seconds", () => {
    const cues = parseSubtitleCues("1\n01:02:03.500 --> 01:02:05.250\nLong\n");
    expect(cues[0].start).toBeCloseTo(3723.5);
    expect(cues[0].end).toBeCloseTo(3725.25);
  });
  it("joins multi-line cue text with newlines", () => {
    const cues = parseSubtitleCues("1\n00:00:01,000 --> 00:00:04,000\nLine one\nLine two\n");
    expect(cues[0].text).toBe("Line one\nLine two");
  });
  it("skips blocks without a timing arrow", () => {
    expect(parseSubtitleCues("1\nJust some text\n\n2\n00:00:01,000 --> 00:00:02,000\nKept\n")).toHaveLength(1);
  });
  it("skips cues whose end is not after start", () => {
    expect(parseSubtitleCues("1\n00:00:04,000 --> 00:00:02,000\nBackwards\n")).toEqual([]);
    expect(parseSubtitleCues("1\n00:00:02,000 --> 00:00:02,000\nZero\n")).toEqual([]);
  });
  it("skips cues with empty content and unparsable times", () => {
    expect(parseSubtitleCues("1\n00:00:01,000 --> 00:00:02,000\n   \n")).toEqual([]);
    expect(parseSubtitleCues("1\nsoon --> later\nText\n")).toEqual([]);
  });
  it("preserves unicode and emoji cue text", () => {
    const cues = parseSubtitleCues("1\n00:00:01,000 --> 00:00:02,000\n日本語 🎬 café\n");
    expect(cues[0].text).toBe("日本語 🎬 café");
  });
  it("parses several cues in one document", () => {
    const src = "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n\n3\n00:00:05,000 --> 00:00:06,000\nC\n";
    const cues = parseSubtitleCues(src);
    expect(cues.map((c) => c.text)).toEqual(["A", "B", "C"]);
  });
});

// --- DOM-backed caption track helpers ---------------------------------------

interface MockCue {
  start: number;
  end: number;
  text: string;
}

interface MockTrack {
  kind: string;
  label: string;
  mode: string;
  cues: MockCue[];
  activeCues: MockCue[];
  addCue: (c: MockCue) => void;
  removeCue: (c: MockCue) => void;
}

function makeTrack(label: string, kind = "subtitles"): MockTrack {
  const track: MockTrack = {
    kind,
    label,
    mode: "disabled",
    cues: [],
    activeCues: [],
    addCue(c) {
      track.cues.push(c);
    },
    removeCue(c) {
      const i = track.cues.indexOf(c);
      if (i >= 0) track.cues.splice(i, 1);
    },
  };
  return track;
}

interface FakeVideo {
  textTracks: MockTrack[];
  currentTime: number;
  added: number;
  addTextTrack: (kind: string, label: string) => MockTrack;
}

function makeVideo(tracks: MockTrack[] = []): FakeVideo {
  const video: FakeVideo = {
    textTracks: tracks,
    currentTime: 0,
    added: 0,
    addTextTrack(kind: string, label: string) {
      video.added += 1;
      const t = makeTrack(label, kind);
      tracks.push(t);
      return t;
    },
  };
  return video;
}

const g = globalThis as unknown as Record<string, unknown>;
const savedGlobals = { VTTCue: g.VTTCue, TextTrackCue: g.TextTrackCue, window: g.window };

function useVTTCue() {
  g.VTTCue = class {
    start: number;
    end: number;
    text: string;
    constructor(start: number, end: number, text: string) {
      this.start = start;
      this.end = end;
      this.text = text;
    }
  };
  g.TextTrackCue = undefined;
}

function useLegacyCue() {
  g.VTTCue = undefined;
  g.TextTrackCue = class {
    start: number;
    end: number;
    text: string;
    constructor(start: number, end: number, text: string) {
      this.start = start;
      this.end = end;
      this.text = text;
    }
  };
}

afterEach(() => {
  g.VTTCue = savedGlobals.VTTCue;
  g.TextTrackCue = savedGlobals.TextTrackCue;
  g.window = savedGlobals.window;
});

const CUES: SubtitleCue[] = [
  { start: 1, end: 4, text: "Hello" },
  { start: 10, end: 12, text: "World" },
];

describe("attachSubtitleTrack", () => {
  it("creates a new showing track with all cues when none exists", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    expect(video.added).toBe(1);
    expect(state.label).toBe("English");
    expect(state.track).not.toBeNull();
    const track = state.track as unknown as MockTrack;
    expect(track.mode).toBe("showing");
    expect(track.cues).toHaveLength(2);
  });
  it("reuses an existing matching track instead of stacking", () => {
    useVTTCue();
    const video = makeVideo([makeTrack("English")]);
    attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    expect(video.added).toBe(0);
    expect(video.textTracks).toHaveLength(1);
  });
  it("does not duplicate cues when the existing track already has them", () => {
    useVTTCue();
    const existing = makeTrack("English");
    existing.cues.push({ start: 0, end: 1, text: "old" });
    const video = makeVideo([existing]);
    attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    expect(existing.cues).toHaveLength(1);
  });
  it("ignores tracks with a different label or kind", () => {
    useVTTCue();
    const video = makeVideo([makeTrack("Français"), makeTrack("English", "captions")]);
    attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    expect(video.added).toBe(1);
    expect(video.textTracks).toHaveLength(3);
  });
  it("snapshots the cue list so later caller mutation is harmless", () => {
    useVTTCue();
    const video = makeVideo();
    const input = [...CUES];
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", input);
    input.push({ start: 99, end: 100, text: "late" });
    expect(state.cues).toHaveLength(2);
  });
  it("handles an empty cue list", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", []);
    expect(state.cues).toEqual([]);
    expect((state.track as unknown as MockTrack).mode).toBe("showing");
  });
  it("cleanup is safe to call twice", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    state.cleanup();
    expect(() => state.cleanup()).not.toThrow();
  });
  it("survives a throwing track mode setter", () => {
    useVTTCue();
    const video = makeVideo();
    const videoEl = video as unknown as HTMLVideoElement;
    const throwing = makeTrack("English");
    Object.defineProperty(throwing, "mode", {
      get: () => "disabled",
      set: () => {
        throw new Error("denied");
      },
    });
    (video as unknown as { addTextTrack: unknown }).addTextTrack = () => throwing;
    expect(() => attachSubtitleTrack(videoEl, "English", CUES)).not.toThrow();
  });
  it("falls back to the legacy TextTrackCue constructor when VTTCue is missing", () => {
    useLegacyCue();
    const video = makeVideo();
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    expect((state.track as unknown as MockTrack).cues).toHaveLength(2);
  });
  it("adds no cues when neither cue constructor exists", () => {
    g.VTTCue = undefined;
    g.TextTrackCue = undefined;
    const video = makeVideo();
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    expect((state.track as unknown as MockTrack).cues).toHaveLength(0);
    expect((state.track as unknown as MockTrack).mode).toBe("showing");
  });
  it("preserves unicode cue text through the track", () => {
    useVTTCue();
    const video = makeVideo();
    const uni = [{ start: 0, end: 1, text: "日本語 🎬" }];
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "日本語", uni);
    expect((state.track as unknown as MockTrack).cues[0].text).toBe("日本語 🎬");
  });
});

describe("reattachSubtitleTrack", () => {
  it("is a no-op for null state", () => {
    const video = makeVideo();
    expect(() => reattachSubtitleTrack(video as unknown as HTMLVideoElement, null)).not.toThrow();
    expect(video.added).toBe(0);
  });
  it("recreates the track when the old one detached from the element", () => {
    useVTTCue();
    g.window = { requestAnimationFrame: (cb: () => void) => cb() };
    const video = makeVideo();
    const state = attachSubtitleTrack(video as unknown as HTMLVideoElement, "English", CUES);
    const orphan = state.track as unknown as MockTrack;
    (video as unknown as { textTracks: MockTrack[] }).textTracks = [];
    reattachSubtitleTrack(video as unknown as HTMLVideoElement, state);
    expect(state.track).not.toBe(orphan);
    expect((state.track as unknown as MockTrack).cues).toHaveLength(2);
  });
  it("reuses a matching track already on the element", () => {
    useVTTCue();
    g.window = { requestAnimationFrame: (cb: () => void) => cb() };
    const video = makeVideo();
    const state: SubtitleTrackState = {
      track: null,
      label: "English",
      cues: [...CUES],
      cleanup: () => {},
    };
    const existing = makeTrack("English");
    (video as unknown as { textTracks: MockTrack[] }).textTracks = [existing];
    reattachSubtitleTrack(video as unknown as HTMLVideoElement, state);
    expect(state.track).toBe(existing);
    expect(video.added).toBe(0);
  });
  it("refills cues on a still-attached but emptied track", () => {
    useVTTCue();
    g.window = undefined;
    const attached = makeTrack("English");
    const video = makeVideo([attached]);
    const state: SubtitleTrackState = {
      track: attached as unknown as TextTrack,
      label: "English",
      cues: [...CUES],
      cleanup: () => {},
    };
    reattachSubtitleTrack(video as unknown as HTMLVideoElement, state);
    expect(attached.cues).toHaveLength(2);
  });
  it("leaves a healthy attached track alone", () => {
    useVTTCue();
    g.window = undefined;
    const attached = makeTrack("English");
    attached.cues.push({ start: 0, end: 1, text: "x" });
    attached.mode = "showing";
    const video = makeVideo([attached]);
    const state: SubtitleTrackState = {
      track: attached as unknown as TextTrack,
      label: "English",
      cues: [...CUES],
      cleanup: () => {},
    };
    reattachSubtitleTrack(video as unknown as HTMLVideoElement, state);
    expect(attached.cues).toHaveLength(1);
    expect(attached.mode).toBe("showing");
  });
  it("re-asserts showing on the next animation frame", () => {
    useVTTCue();
    let raf: (() => void) | null = null;
    g.window = {
      requestAnimationFrame: (cb: () => void) => {
        raf = cb;
      },
    };
    const attached = makeTrack("English");
    attached.cues.push({ start: 0, end: 1, text: "x" });
    const video = makeVideo([attached]);
    const state: SubtitleTrackState = {
      track: attached as unknown as TextTrack,
      label: "English",
      cues: [...CUES],
      cleanup: () => {},
    };
    reattachSubtitleTrack(video as unknown as HTMLVideoElement, state);
    expect(raf).not.toBeNull();
    attached.mode = "disabled";
    (raf as unknown as () => void)();
    expect(attached.mode).toBe("showing");
  });
  it("survives a throwing mode setter", () => {
    useVTTCue();
    g.window = undefined;
    const attached = makeTrack("English");
    Object.defineProperty(attached, "mode", {
      get: () => "disabled",
      set: () => {
        throw new Error("denied");
      },
    });
    const video = makeVideo([attached]);
    const state: SubtitleTrackState = {
      track: attached as unknown as TextTrack,
      label: "English",
      cues: [...CUES],
      cleanup: () => {},
    };
    expect(() => reattachSubtitleTrack(video as unknown as HTMLVideoElement, state)).not.toThrow();
  });
});

describe("ensureActiveCues", () => {
  const attachedState = (video: FakeVideo, currentTime: number): SubtitleTrackState => {
    const track = makeTrack("English");
    (video as unknown as { textTracks: MockTrack[] }).textTracks = [track];
    video.currentTime = currentTime;
    return {
      track: track as unknown as TextTrack,
      label: "English",
      cues: [...CUES],
      cleanup: () => {},
    };
  };
  it("is a no-op for null state", () => {
    useVTTCue();
    const video = makeVideo();
    expect(() => ensureActiveCues(video as unknown as HTMLVideoElement, null)).not.toThrow();
  });
  it("is a no-op when the state has no track", () => {
    useVTTCue();
    const video = makeVideo();
    const state: SubtitleTrackState = { track: null, label: "x", cues: [...CUES], cleanup: () => {} };
    expect(() => ensureActiveCues(video as unknown as HTMLVideoElement, state)).not.toThrow();
  });
  it("forces a hidden track back to showing", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachedState(video, 2);
    (state.track as unknown as MockTrack).mode = "disabled";
    ensureActiveCues(video as unknown as HTMLVideoElement, state);
    expect((state.track as unknown as MockTrack).mode).toBe("showing");
  });
  it("refills cues when the DOM track lost them", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachedState(video, 2);
    ensureActiveCues(video as unknown as HTMLVideoElement, state);
    expect((state.track as unknown as MockTrack).cues).toHaveLength(2);
  });
  it("does nothing when no cue covers the playhead", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachedState(video, 99);
    const track = state.track as unknown as MockTrack;
    track.cues.push({ start: 1, end: 4, text: "Hello" });
    const before = track.cues.length;
    ensureActiveCues(video as unknown as HTMLVideoElement, state);
    expect(track.cues).toHaveLength(before);
  });
  it("does nothing when the browser already reports active cues", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachedState(video, 2);
    const track = state.track as unknown as MockTrack;
    track.cues.push({ start: 1, end: 4, text: "Hello" });
    track.activeCues.push(track.cues[0]);
    ensureActiveCues(video as unknown as HTMLVideoElement, state);
    expect(track.cues).toHaveLength(1);
  });
  it("refreshes a stale matcher when a cue should be active but none is", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachedState(video, 2);
    const track = state.track as unknown as MockTrack;
    track.cues.push({ start: 50, end: 60, text: "stale" });
    track.activeCues = [];
    ensureActiveCues(video as unknown as HTMLVideoElement, state);
    expect(track.cues.map((c) => c.text)).toEqual(["Hello", "World"]);
  });
  it("returns silently when the mode setter throws", () => {
    useVTTCue();
    const video = makeVideo();
    const state = attachedState(video, 2);
    const track = state.track as unknown as MockTrack;
    let mode = "disabled";
    Object.defineProperty(track, "mode", {
      get: () => mode,
      set: (v: string) => {
        mode = v;
        throw new Error("denied");
      },
    });
    expect(() => ensureActiveCues(video as unknown as HTMLVideoElement, state)).not.toThrow();
  });
});
