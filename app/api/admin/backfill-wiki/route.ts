import { NextRequest, NextResponse } from "next/server";
import { GET as wikiCronGet } from "@/app/api/cron/wiki-about/route";

// Manual trigger to backfill Wikipedia "about" text without waiting for the
// daily cron schedule. Same auth as the cron itself (Bearer CRON_SECRET).
export async function POST(req: NextRequest) {
  return wikiCronGet(req);
}
