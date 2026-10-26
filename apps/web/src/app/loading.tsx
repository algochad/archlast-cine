export default function Loading() {
  return (
    <div className="page-shell pt-32" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-[min(60vh,28rem)] w-full rounded-3xl" />
      <div className="mt-10 flex gap-4 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="w-[42%] shrink-0 sm:w-[28%] md:w-[21%] lg:w-[16.5%] xl:w-[14%]">
            <div className="skeleton aspect-[2/3] rounded-[1.1rem]" />
            <div className="skeleton mt-3 h-3.5 w-3/4 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
