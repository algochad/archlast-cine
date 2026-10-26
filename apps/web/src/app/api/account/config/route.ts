import { NextResponse } from "next/server";
import { REGION_VALUES } from "../_lib";

/** Server-only deployment config: which region pools the Rust backend serves. */
export async function GET() {
  const env = process.env.MB_REGIONS?.trim();
  const availableRegions = env
    ? env
        .split(",")
        .map((region) => region.trim())
        .filter((region): region is (typeof REGION_VALUES)[number] =>
          (REGION_VALUES as readonly string[]).includes(region),
        )
    : [];
  return NextResponse.json({
    availableRegions: availableRegions.length > 0 ? availableRegions : ["ph"],
    defaultRegion: "ph",
  });
}
