import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_ABOUT_CHARS, truncateAtSentence } from "@/lib/asset-market";

// Write hand-translated About text for one asset/language. Used for every
// Crypto about_ko/about_ja value (100% manual by decision — see
// admin/backfill-crypto-about for why no automated KO/JA source is trusted)
// and can also patch individual Wikipedia-sourced assets if a translation
// ever needs a manual correction.
//
// Body: { assetKey: "LINK-PERP", lang: "ko" | "ja", text: "..." }
//
// curl -X POST https://coininfo-api.vercel.app/api/admin/set-about-translation \
//   -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
//   -d '{"assetKey":"LINK-PERP","lang":"ko","text":"..."}'

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const assetKey = body?.assetKey;
  const lang = body?.lang;
  const text = body?.text;

  if (typeof assetKey !== "string" || !assetKey.endsWith("-PERP")) {
    return NextResponse.json({ error: "assetKey must be like 'LINK-PERP'" }, { status: 400 });
  }
  if (lang !== "ko" && lang !== "ja") {
    return NextResponse.json({ error: "lang must be 'ko' or 'ja'" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text must be a non-empty string" }, { status: 400 });
  }

  const { data: existing } = await db
    .from("asset_market_snapshots")
    .select("fields")
    .eq("asset_key", assetKey)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: `${assetKey} has no existing row — run the English backfill for it first` },
      { status: 404 }
    );
  }

  const fieldKey = `about_${lang}`;
  const { error } = await db
    .from("asset_market_snapshots")
    .update({ fields: { ...(existing.fields ?? {}), [fieldKey]: truncateAtSentence(text.trim(), MAX_ABOUT_CHARS) } })
    .eq("asset_key", assetKey);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ assetKey, field: fieldKey, length: Math.min(text.trim().length, MAX_ABOUT_CHARS) });
}
