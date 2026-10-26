"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <div className="page-shell flex min-h-[80vh] flex-col items-center justify-center text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-rose/10 text-3xl ring-1 ring-rose/40">⚠️</span>
      <h1 className="display-title mt-6 text-[clamp(1.8rem,4vw,2.8rem)]">Something went off-script</h1>
      <p className="mt-3 max-w-md text-[15px] text-zinc-400">An unexpected error interrupted this page. Trying again usually fixes it.</p>
      <button type="button" onClick={reset} className="btn-solid mt-8 px-8 py-3.5 text-[15px]">
        Try again
      </button>
    </div>
  );
}
