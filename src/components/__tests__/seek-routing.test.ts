import { describe, expect, it, vi, type Mock } from "vitest";
import { clampSeekTarget, isSeekableDuration } from "../../lib/seek";

/**
 * Keyboard / media-session / resume routing through the shared absolute seek
 * dispatcher (`seekAbsoluteRef` in watch-player.tsx).
 *
 *   keyboard ArrowLeft/Right -> seekBy(delta):
 *     transcode: dispatcher(clamp(absolutePosition() + delta, 0..total))
 *     direct:    pin + video.currentTime = clamp(now + delta, 0..duration)
 *   media-session "seekto"  -> dispatcher(d.seekTime) when seekTime != null
 *   resume (transcode)      -> dispatcher(saved position)
 *   resume (direct)         -> readyState>=1 seeks now; otherwise defers via
 *                              loadedmetadata (iOS must not seek early)
 *
 * All clamping/gating flows through the real shared helpers; the rig below
 * only fakes the element + the dispatcher spy, never the helpers.
 */

interface FakeVideo {
  currentTime: number;
  duration: number;
  readyState: number;
  played: boolean;
}

interface SeekRig {
  transcode: boolean;
  total: number | null | undefined;
  video: FakeVideo;
  dispatched: number[];
  dispatcher: Mock<(abs: number) => void>;
}

function createRig(opts: { transcode: boolean; total: number | null | undefined; video: FakeVideo }): SeekRig {
  const dispatched: number[] = [];
  const dispatcher = vi.fn((abs: number): void => {
    dispatched.push(abs);
  });
  return { transcode: opts.transcode, total: opts.total, video: opts.video, dispatched, dispatcher };
}

/** Mirrors the transcode branch of seekBy/dispatcher call sites. */
function routeDelta(rig: SeekRig, absPosition: number, delta: number): number | null {
  if (rig.transcode) {
    if (rig.total == null || !Number.isFinite(rig.total)) return null;
    const target = clampSeekTarget(absPosition + delta, rig.total);
    if (target !== null) rig.dispatcher(target);
    return target;
  }
  if (!isSeekableDuration(rig.video.duration)) return null;
  const target = clampSeekTarget(
    rig.video.currentTime + delta,
    rig.video.duration,
  );
  if (target === null) return null;
  rig.video.currentTime = target;
  return target;
}

/** Mirrors the media-session seekto handler. */
function routeSeekTo(rig: SeekRig, seekTime: number | null | undefined): number | null {
  if (seekTime == null) return null;
  const total = rig.transcode
    ? rig.total
    : rig.video.duration;
  const target = clampSeekTarget(seekTime, total);
  if (target === null) return null;
  if (rig.transcode) rig.dispatcher(target);
  else rig.video.currentTime = target;
  return target;
}

/** Mirrors resume(): transcode routes via dispatcher, direct is ready-gated. */
function routeResume(rig: SeekRig, pos: number): "dispatched" | "seeked" | "deferred" | "ignored" {
  if (!(pos > 0)) return "ignored";
  if (rig.transcode) {
    const target = clampSeekTarget(pos, rig.total);
    if (target === null) return "ignored";
    rig.dispatcher(target);
    return "dispatched";
  }
  if (rig.video.readyState >= 1) {
    if (!isSeekableDuration(rig.video.duration)) return "ignored";
    const target = clampSeekTarget(pos, rig.video.duration);
    if (target === null) return "ignored";
    rig.video.currentTime = target;
    return "seeked";
  }
  return "deferred"; // wait for loadedmetadata (iOS early-seek guard)
}

/** Mirrors the direct branch of seekAbsolute's duration gating. */
function directSeek(
  video: FakeVideo,
  target: number,
): boolean {
  if (!isSeekableDuration(video.duration)) return false;
  const t = clampSeekTarget(target, video.duration);
  if (t === null) return false;
  video.currentTime = t;
  return true;
}

describe("keyboard routing through the shared dispatcher", () => {
  it("ArrowRight on transcode dispatches position+delta", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeDelta(rig, 100, 10)).toBe(110);
    expect(rig.dispatcher).toHaveBeenCalledWith(110);
  });

  it("ArrowLeft on transcode clamps at 0", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeDelta(rig, 5, -10)).toBe(0);
    expect(rig.dispatcher).toHaveBeenCalledWith(0);
  });

  it("ArrowRight on transcode clamps at the total", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeDelta(rig, 595, 10)).toBe(600);
    expect(rig.dispatcher).toHaveBeenCalledWith(600);
  });

  it("Arrow keys on the direct path move currentTime with a clamp", () => {
    const rig = createRig({
      transcode: false,
      total: null,
      video: { currentTime: 100, duration: 600, readyState: 4, played: false },
    });
    expect(routeDelta(rig, 100, -10)).toBe(90);
    expect(rig.video.currentTime).toBe(90);
    expect(rig.dispatcher).not.toHaveBeenCalled();
  });

  it("Arrow keys with an unseekable direct duration do nothing", () => {
    const rig = createRig({
      transcode: false,
      total: null,
      video: { currentTime: 100, duration: NaN, readyState: 4, played: false },
    });
    expect(routeDelta(rig, 100, 10)).toBeNull();
    expect(rig.video.currentTime).toBe(100);
  });

  it("Arrow keys with a non-finite transcode total dispatch nothing", () => {
    const rig = createRig({
      transcode: true,
      total: NaN,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeDelta(rig, 100, 10)).toBeNull();
    expect(rig.dispatcher).not.toHaveBeenCalled();
  });
});

describe("media-session seekto routing", () => {
  it("routes a finite seekTime through the dispatcher (transcode)", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeSeekTo(rig, 200)).toBe(200);
    expect(rig.dispatcher).toHaveBeenCalledWith(200);
  });

  it("ignores a null/undefined seekTime", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeSeekTo(rig, null)).toBeNull();
    expect(routeSeekTo(rig, undefined)).toBeNull();
    expect(rig.dispatcher).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range seekTime instead of passing it through", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 5, duration: 30, readyState: 4, played: false },
    });
    expect(routeSeekTo(rig, 9999)).toBe(600);
    expect(routeSeekTo(rig, -50)).toBe(0);
  });

  it("drops a non-finite seekTime", () => {
    const rig = createRig({
      transcode: false,
      total: null,
      video: { currentTime: 5, duration: 600, readyState: 4, played: false },
    });
    expect(routeSeekTo(rig, Infinity)).toBeNull();
    expect(routeSeekTo(rig, NaN)).toBeNull();
    expect(rig.video.currentTime).toBe(5);
  });

  it("direct-path seekto writes currentTime without the dispatcher", () => {
    const rig = createRig({
      transcode: false,
      total: null,
      video: { currentTime: 5, duration: 600, readyState: 4, played: false },
    });
    expect(routeSeekTo(rig, 300)).toBe(300);
    expect(rig.video.currentTime).toBe(300);
    expect(rig.dispatcher).not.toHaveBeenCalled();
  });
});

describe("resume routing", () => {
  it("transcode resume dispatches the saved position", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 0, duration: 30, readyState: 4, played: false },
    });
    expect(routeResume(rig, 321)).toBe("dispatched");
    expect(rig.dispatcher).toHaveBeenCalledWith(321);
  });

  it("direct resume seeks immediately when readyState>=1", () => {
    const rig = createRig({
      transcode: false,
      total: null,
      video: { currentTime: 0, duration: 600, readyState: 1, played: false },
    });
    expect(routeResume(rig, 321)).toBe("seeked");
    expect(rig.video.currentTime).toBe(321);
  });

  it("direct resume defers before readyState>=1 (iOS early-seek guard)", () => {
    const rig = createRig({
      transcode: false,
      total: null,
      video: { currentTime: 0, duration: NaN, readyState: 0, played: false },
    });
    expect(routeResume(rig, 321)).toBe("deferred");
    expect(rig.video.currentTime).toBe(0);
  });

  it("resume with pos<=0 is ignored on every path", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 0, duration: 30, readyState: 4, played: false },
    });
    expect(routeResume(rig, 0)).toBe("ignored");
    expect(routeResume(rig, -5)).toBe("ignored");
    expect(rig.dispatcher).not.toHaveBeenCalled();
  });

  it("resume clamps a stale position beyond the total", () => {
    const rig = createRig({
      transcode: true,
      total: 600,
      video: { currentTime: 0, duration: 30, readyState: 4, played: false },
    });
    expect(routeResume(rig, 9999)).toBe("dispatched");
    expect(rig.dispatcher).toHaveBeenCalledWith(600);
  });
});

describe("duration gating (unknown duration blocks instead of jumping to 0)", () => {
  it("blocks when duration is NaN and leaves currentTime untouched", () => {
    const video: FakeVideo = {
      currentTime: 55,
      duration: NaN,
      readyState: 4,
      played: false,
    };
    expect(directSeek(video, 120)).toBe(false);
    expect(video.currentTime).toBe(55);
  });

  it("blocks when duration is Infinity", () => {
    const video: FakeVideo = {
      currentTime: 55,
      duration: Infinity,
      readyState: 4,
      played: false,
    };
    expect(directSeek(video, 120)).toBe(false);
    expect(video.currentTime).toBe(55);
  });

  it("blocks when duration is 0 (metadata not loaded yet)", () => {
    const video: FakeVideo = {
      currentTime: 55,
      duration: 0,
      readyState: 0,
      played: false,
    };
    expect(directSeek(video, 120)).toBe(false);
    expect(video.currentTime).toBe(55);
  });

  it("blocks when duration is negative", () => {
    const video: FakeVideo = {
      currentTime: 55,
      duration: -1,
      readyState: 4,
      played: false,
    };
    expect(directSeek(video, 10)).toBe(false);
    expect(video.currentTime).toBe(55);
  });

  it("rejects a non-finite target even with a healthy duration", () => {
    const video: FakeVideo = {
      currentTime: 55,
      duration: 600,
      readyState: 4,
      played: false,
    };
    expect(directSeek(video, NaN)).toBe(false);
    expect(directSeek(video, Infinity)).toBe(false);
    expect(video.currentTime).toBe(55);
  });

  it("seeks and clamps normally once the duration is seekable", () => {
    const video: FakeVideo = {
      currentTime: 55,
      duration: 600,
      readyState: 4,
      played: false,
    };
    expect(directSeek(video, 120)).toBe(true);
    expect(video.currentTime).toBe(120);
    expect(directSeek(video, 9999)).toBe(true);
    expect(video.currentTime).toBe(600);
  });
});

describe("first-skip deferral (unknown duration queues, retry to same spot lands)", () => {
  interface DeferredQueue {
    queued: number | null;
    notice: string | null;
    request: (target: number, duration: number | null | undefined) => "seeked" | "deferred";
    onMetadata: (duration: number) => number | null;
    cancel: () => void;
  }

  function createDeferredQueue(video: FakeVideo): DeferredQueue {
    let queued: number | null = null;
    let notice: string | null = null;
    return {
      get queued(): number | null {
        return queued;
      },
      get notice(): string | null {
        return notice;
      },
      request(target: number, duration: number | null | undefined): "seeked" | "deferred" {
        if (!Number.isFinite(target)) return "deferred";
        const clamped = clampSeekTarget(target, duration);
        if (clamped === null) {
          queued = Number.isFinite(target) ? target : null;
          if (queued !== null) notice = "Waiting for video info…";
          return "deferred";
        }
        video.currentTime = clamped;
        queued = null;
        notice = null;
        return "seeked";
      },
      onMetadata(duration: number): number | null {
        if (queued === null) return null;
        const target = clampSeekTarget(queued, duration);
        if (target === null) return null;
        video.currentTime = target;
        const landed = target;
        queued = null;
        notice = null;
        return landed;
      },
      cancel(): void {
        queued = null;
        notice = null;
      },
    };
  }

  it("first skip with NaN duration defers and never touches currentTime", () => {
    const video: FakeVideo = { currentTime: 0, duration: NaN, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(120, NaN)).toBe("deferred");
    expect(video.currentTime).toBe(0);
    expect(q.queued).toBe(120);
  });

  it("first skip with Infinity duration defers with a notice", () => {
    const video: FakeVideo = { currentTime: 0, duration: Infinity, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(120, Infinity)).toBe("deferred");
    expect(video.currentTime).toBe(0);
    expect(q.notice).toBe("Waiting for video info…");
  });

  it("first skip with 0 duration defers (early metadata, not a jump to 0)", () => {
    const video: FakeVideo = { currentTime: 0, duration: 0, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(45, 0)).toBe("deferred");
    expect(video.currentTime).not.toBe(45);
    expect(video.currentTime).toBe(0);
    expect(q.queued).toBe(45);
  });

  it("retry to the same spot post-metadata lands exactly", () => {
    const video: FakeVideo = { currentTime: 0, duration: NaN, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(120, NaN)).toBe("deferred");
    video.duration = 600;
    video.readyState = 1;
    expect(q.onMetadata(600)).toBe(120);
    expect(video.currentTime).toBe(120);
    expect(q.queued).toBeNull();
    expect(q.notice).toBeNull();
  });

  it("flushed target clamps when metadata reveals a shorter title", () => {
    const video: FakeVideo = { currentTime: 0, duration: NaN, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(9999, NaN)).toBe("deferred");
    expect(q.onMetadata(600)).toBe(600);
    expect(video.currentTime).toBe(600);
  });

  it("a newer request supersedes the queued first skip", () => {
    const video: FakeVideo = { currentTime: 0, duration: NaN, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(120, NaN)).toBe("deferred");
    expect(q.request(200, NaN)).toBe("deferred");
    expect(q.queued).toBe(200);
    expect(q.onMetadata(600)).toBe(200);
    expect(video.currentTime).toBe(200);
  });

  it("teardown cancels the queued skip so no stale seek fires", () => {
    const video: FakeVideo = { currentTime: 0, duration: NaN, readyState: 0, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(120, NaN)).toBe("deferred");
    q.cancel();
    expect(q.onMetadata(600)).toBeNull();
    expect(video.currentTime).toBe(0);
  });

  it("transcode first skip with null total defers, then lands post-manifest", () => {
    const video: FakeVideo = { currentTime: 0, duration: 30, readyState: 4, played: false };
    const q = createDeferredQueue(video);
    expect(q.request(321, null)).toBe("deferred");
    expect(video.currentTime).toBe(0);
    expect(q.onMetadata(8887.9)).toBe(321);
    expect(video.currentTime).toBe(321);
  });
});
