import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-shell flex min-h-[80vh] flex-col items-center justify-center text-center">
      <p className="rank-numeral text-[clamp(6rem,22vw,13rem)]" aria-hidden="true">
        404
      </p>
      <h1 className="display-title -mt-2 text-[clamp(1.8rem,4vw,2.8rem)]">This scene was cut</h1>
      <p className="mt-3 max-w-md text-[15px] text-zinc-400">
        The page you’re looking for doesn’t exist, or the title has moved.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-solid px-8 py-3.5 text-[15px]">
          Back to home
        </Link>
        <Link href="/search" className="btn-glass px-8 py-3.5 text-[15px]">
          Search titles
        </Link>
      </div>
    </div>
  );
}
