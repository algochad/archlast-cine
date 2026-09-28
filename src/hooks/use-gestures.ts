"use client";

import { useCallback, useRef } from "react";
import { tapWindowMs, jumpForTaps, holdFired, isVerticalSwipe, distance } from "@/lib/gestures";

export type GestureSide = "left" | "center" | "right";

export interface UseGesturesOptions {
  lockedRef: React.RefObject<boolean>;
  seekStepRef: React.RefObject<number>;
  pokeControls: () => void;
  flashNotice: (msg: string) => void;
  onSingleTap?: () => void;
  onDoubleTapSeek?: (side: "left" | "right", jump: number, count: number) => void;
  onSwipe?: (side: "left" | "right", dy: number) => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  onPinch?: (scale: number) => void;
}

export function useGestures(options: UseGesturesOptions) {
  const {
    lockedRef,
    seekStepRef,
    pokeControls,
    flashNotice: _flashNotice,
    onSingleTap,
    onDoubleTapSeek,
    onSwipe,
    onHoldStart,
    onHoldEnd,
    onPinch,
  } = options;

  // Tap counting + debouncing
  const tapCountRef = useRef(0);
  const tapSideRef = useRef<GestureSide | null>(null);
  const lastTapTimeRef = useRef(0);
  const tapDebounceRef = useRef<number | null>(null);

  // Pointer tracking
  const activePointersRef = useRef<Map<number, { x: number; y: number; startX: number; startY: number; startTime: number }>>(new Map());
  const pinchInitialDistRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const isSwipingRef = useRef(false);
  // Prevent single-tap firing after a swipe/pinch/hold
  const suppressTapRef = useRef(false);

  const getSide = useCallback((x: number, rect: DOMRect): GestureSide => {
    const w = rect.width;
    if (x - rect.left < w / 3) return "left";
    if (x - rect.left > (w * 2) / 3) return "right";
    return "center";
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearTapDebounce = useCallback(() => {
    if (tapDebounceRef.current != null) {
      window.clearTimeout(tapDebounceRef.current);
      tapDebounceRef.current = null;
    }
  }, []);

  const scheduleTapCommit = useCallback(() => {
    clearTapDebounce();
    // trailing-edge 400ms debounce collapsing transcode to one restart
    tapDebounceRef.current = window.setTimeout(() => {
      tapDebounceRef.current = null;
      const count = tapCountRef.current;
      const side = tapSideRef.current;
      // reset for next sequence before callbacks (re-entrancy safe)
      tapCountRef.current = 0;
      tapSideRef.current = null;
      lastTapTimeRef.current = 0;

      if (lockedRef.current) return;
      if (count >= 2 && (side === "left" || side === "right")) {
        const base = seekStepRef.current ?? 10;
        const jump = jumpForTaps(count, base);
        if (onDoubleTapSeek) onDoubleTapSeek(side, jump, count);
        pokeControls();
      } else if (count === 1) {
        // center or outer single tap → togglePlay passthrough
        if (onSingleTap) onSingleTap();
        pokeControls();
      }
    }, 400);
  }, [lockedRef, seekStepRef, pokeControls, onSingleTap, onDoubleTapSeek, clearTapDebounce]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (lockedRef.current) {
      // early-return when locked (no gesture)
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const id = e.pointerId;
    const now = Date.now();
    const x = e.clientX;
    const y = e.clientY;

    // Capture pointer for consistent move/up even outside element
    try { (e.currentTarget as HTMLElement).setPointerCapture(id); } catch {}

    activePointersRef.current.set(id, { x, y, startX: x, startY: y, startTime: now });
    isSwipingRef.current = false;
    suppressTapRef.current = false;

    // Pinch handling: when two pointers are active, capture initial distance
    if (activePointersRef.current.size === 2) {
      // Cancel hold when multi-touch starts
      clearHoldTimer();
      holdTriggeredRef.current = false;
      suppressTapRef.current = true;
      // Cancel pending single-tap debounce — multitouch is not a tap
      clearTapDebounce();
      tapCountRef.current = 0;
      tapSideRef.current = null;
      const pts = Array.from(activePointersRef.current.values());
      if (pts.length === 2) {
        pinchInitialDistRef.current = distance(pts[0].startX, pts[0].startY, pts[1].startX, pts[1].startY);
      }
    } else if (activePointersRef.current.size === 1) {
      // Single pointer: potential tap / swipe / hold
      // Start hold timer (>450ms, <10px move)
      holdTriggeredRef.current = false;
      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        if (lockedRef.current) return;
        // Check move distance
        const p = activePointersRef.current.get(id);
        if (!p) return;
        const move = Math.hypot(p.x - p.startX, p.y - p.startY);
        if (holdFired(Date.now() - p.startTime, move)) {
          // Ensure still single pointer and not swiping
          if (activePointersRef.current.size !== 1) return;
          if (isSwipingRef.current) return;
          holdTriggeredRef.current = true;
          suppressTapRef.current = true;
          // A hold is not a tap — cancel pending tap debounce from prior taps?
          // But hold anywhere should not collapse prior tap count as seek
          // Keep tap debounce? Better to clear taps when hold fires to avoid stray seek after hold release
          clearTapDebounce();
          tapCountRef.current = 0;
          tapSideRef.current = null;
          if (onHoldStart) onHoldStart();
          pokeControls();
        }
      }, 460); // 450 + small margin
    }
  }, [lockedRef, pokeControls, onHoldStart, clearHoldTimer, clearTapDebounce]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (lockedRef.current) return;
    const id = e.pointerId;
    const p = activePointersRef.current.get(id);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;

    // Pinch: two pointers active → compute scale
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      if (pts.length === 2) {
        const curDist = distance(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        const init = pinchInitialDistRef.current;
        if (init != null && init > 0) {
          const scale = curDist / init;
          // Only notify when scale is meaningfully changed; caller maps to cover/contain
          if (onPinch) onPinch(scale);
          pokeControls();
          // Mark swipe suppression and tap suppression
          suppressTapRef.current = true;
          isSwipingRef.current = true;
          clearHoldTimer();
        }
      }
      return;
    }

    // Single pointer move: detect swipe vs hold cancellation
    if (activePointersRef.current.size === 1) {
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const movePx = Math.hypot(dx, dy);

      // Cancel hold if moved >=10px before timer fired
      if (movePx >= 10) {
        clearHoldTimer();
      }

      // Hold already triggered → ignore swipe/tap, but handle hold dragging? no swipe while holding
      if (holdTriggeredRef.current) return;

      // Swipe detection: predominantly vertical
      if (isVerticalSwipe(dx, dy)) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const side = getSide(p.startX, rect);
        if (side === "left" || side === "right") {
          isSwipingRef.current = true;
          suppressTapRef.current = true;
          clearHoldTimer();
          // Cancel pending tap debounce because this is a swipe, not a tap sequence
          clearTapDebounce();
          tapCountRef.current = 0;
          tapSideRef.current = null;
          if (onSwipe) onSwipe(side, dy);
          pokeControls();
        }
      }
    }
  }, [lockedRef, getSide, pokeControls, onSwipe, onPinch, clearHoldTimer, clearTapDebounce]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const id = e.pointerId;
    const p = activePointersRef.current.get(id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    // Release capture
    try { (e.currentTarget as HTMLElement).releasePointerCapture(id); } catch {}

    // Pinch end
    if (Number(activePointersRef.current.size) === 2) {
      // One of two pointers lifting — pinch ends
      activePointersRef.current.delete(id);
      // If one remains, keep it but reset pinch baseline
      const remaining = Number(activePointersRef.current.size);
      if (remaining === 1) {
        pinchInitialDistRef.current = null;
        // Keep the remaining pointer's start as current for potential swipe
      } else {
        pinchInitialDistRef.current = null;
      }
      clearHoldTimer();
      // If hold was active, end it
      if (holdTriggeredRef.current) {
        holdTriggeredRef.current = false;
        if (onHoldEnd) onHoldEnd();
        pokeControls();
      }
      isSwipingRef.current = false;
      suppressTapRef.current = false;
      return;
    }

    // Single pointer up
    if (p) {
      const wasHold = holdTriggeredRef.current;
      clearHoldTimer();
      if (wasHold) {
        holdTriggeredRef.current = false;
        if (onHoldEnd) onHoldEnd();
        pokeControls();
        activePointersRef.current.delete(id);
        isSwipingRef.current = false;
        suppressTapRef.current = false;
        return;
      }

      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const movePx = Math.hypot(dx, dy);
      const dt = Date.now() - p.startTime;

      const isTap = movePx < 10 && dt < 250;

      // Swipe already handled in move; just cleanup if swipe was active
      if (isSwipingRef.current) {
        isSwipingRef.current = false;
        activePointersRef.current.delete(id);
        suppressTapRef.current = false;
        return;
      }

      if (isTap && !suppressTapRef.current) {
        // It's a tap candidate — update tap counting
        const side = getSide(p.startX, rect);
        const now = Date.now();
        // Center third: always single-tap only (avoid double-tap conflict)
        // Outer thirds count towards multi-tap
        if (side === "center") {
          // Center tap: immediately commit as single-tap? But to avoid double-fire
          // with outer double-taps, center taps should not be counted with window.
          // Reset outer tap count and treat as single.
          clearTapDebounce();
          tapCountRef.current = 0;
          tapSideRef.current = null;
          lastTapTimeRef.current = 0;
          if (lockedRef.current) {
            // no action
          } else {
            if (onSingleTap) onSingleTap();
            pokeControls();
          }
        } else {
          // Outer side tap: multi-tap counting
          if (
            tapSideRef.current === side &&
            lastTapTimeRef.current > 0 &&
            now - lastTapTimeRef.current <= tapWindowMs &&
            tapCountRef.current > 0
          ) {
            tapCountRef.current += 1;
          } else {
            tapCountRef.current = 1;
            tapSideRef.current = side;
          }
          lastTapTimeRef.current = now;
          scheduleTapCommit();
        }
      } else if (!isTap) {
        // Not a tap (too much move or too long without hold) — reset tap sequence
        // But don't clear debounce if it was a swipe already cleared
        if (!isSwipingRef.current) {
          // If user dragged but not vertical swipe, reset count to avoid accidental double-tap on next tap
          // Keep debounce? Actually a non-tap move should not count, and also should not fire single tap
          // So just ensure we don't leave stale count
          // Don't reset immediately if debounce is pending from prior taps within window — a drag in the middle should cancel that sequence
          if (movePx >= 10 || dt >= 250) {
            clearTapDebounce();
            tapCountRef.current = 0;
            tapSideRef.current = null;
            lastTapTimeRef.current = 0;
          }
        }
      }
    }

    activePointersRef.current.delete(id);
    isSwipingRef.current = false;
    // suppressTap resets after a tick to allow next sequence
    if (suppressTapRef.current) {
      // keep suppressed until pointer up completes
      window.setTimeout(() => { suppressTapRef.current = false; }, 0);
    }
    // If no pointers remain, pinch baseline reset
    if (activePointersRef.current.size === 0) {
      pinchInitialDistRef.current = null;
    }
  }, [lockedRef, getSide, pokeControls, onSingleTap, onHoldEnd, clearHoldTimer, clearTapDebounce, scheduleTapCommit]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    const id = e.pointerId;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(id); } catch {}
    activePointersRef.current.delete(id);
    clearHoldTimer();
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false;
      if (onHoldEnd) onHoldEnd();
    }
    isSwipingRef.current = false;
    suppressTapRef.current = false;
    if (activePointersRef.current.size < 2) pinchInitialDistRef.current = null;
    // Don't clear tap debounce on cancel — keep pending tap commit? but cancel is rare
  }, [onHoldEnd, clearHoldTimer]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
