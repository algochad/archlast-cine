"use client";

import type JASSUBType from "jassub";

let instance: InstanceType<typeof JASSUBType> | null = null;
let currentVideo: HTMLVideoElement | null = null;

export async function attachJassub(
  video: HTMLVideoElement,
  assText: string,
): Promise<InstanceType<typeof JASSUBType> | null> {
  if (typeof window === "undefined") return null;
  if (!video || !assText) return null;
  // Teardown previous
  if (instance) {
    try {
      await instance.destroy();
    } catch {}
    instance = null;
    currentVideo = null;
  }
  try {
    // lazy only for ASS — WASM + worker cost paid only when ASS track chosen (dynamic specifier required)
    const mod = await import("jassub");
    const JASSUB = mod.default;
    const inst = new JASSUB({
      video,
      subContent: assText,
      workerUrl: "/jassub-worker.js",
      wasmUrl: "/jassub-worker.wasm",
      modernWasmUrl: "/jassub-worker-modern.wasm",
    });
    await inst.ready;
    instance = inst;
    currentVideo = video;
    return inst;
  } catch {
    return null;
  }
}

export async function destroyJassub(): Promise<void> {
  if (!instance) return;
  try {
    await instance.destroy();
  } catch {}
  instance = null;
  currentVideo = null;
}

export function getJassubInstance(): InstanceType<typeof JASSUBType> | null {
  return instance;
}

export function isJassubFor(video: HTMLVideoElement): boolean {
  return currentVideo === video && instance != null;
}
