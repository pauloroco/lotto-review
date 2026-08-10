// Supabase Edge Function: fetch-draw-result
//
// Looks up PCSO draw results from lottopcso.com (a public results archive —
// PCSO's own official site disallows automated/bot access via robots.txt).
//
// Modes:
//   1. ?date=YYYY-MM-DD              -> ALL games that drew on that date
//   2. ?date=YYYY-MM-DD&game=6-42    -> just that one game on that date
//   3. ?game=6-42                    -> latest published result for that game
//
// Parsing approach: scan for every "Winning Combination" occurrence on the
// page (these only appear right inside a real per-game results table), then
// for each one, look a short distance BACKWARD to find which game label is
// closest — that's the game that table belongs to. This is more robust than
// searching for game-label text first, since a label like "6/42 Lotto" can
// also appear in navigation/related-links text elsewhere on the page, far
// from any real table; anchoring on "Winning Combination" avoids that.
//
// Deploy with: supabase functions deploy fetch-draw-result --no-verify-jwt

// deno-lint-ignore-file no-explicit-any

const GAME_SLUGS: Record<string, string> = {
  "6-42": "6-42-lotto-result",
  "6-45": "6-45-lotto-result",
  "6-49": "6-49-lotto-result",
  "6-55": "6-55-lotto-result",
  "6-58": "6-58-lotto-result",
};

// Exact label text as it appears in lottopcso.com's result tables
const GAME_TABLE_LABELS: Record<string, string> = {
  "6-42": "6/42 Lotto",
  "6-45": "6/45 Mega Lotto",
  "6-49": "6/49 Super Lotto",
  "6-55": "6/55 Grand Lotto",
  "6-58": "6/58 Ultra Lotto",
};

const GAME_LABELS: Record<string, string> = {
  "6-42": "6/42",
  "6-45": "6/45",
  "6-49": "6/49",
  "6-55": "6/55",
  "6-58": "6/58",
};

const ALL_GAME_IDS = Object.keys(GAME_SLUGS);

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type GameResult = { game: string; gameLabel: string; numbers: number[]; jackpot: string | null };

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateToISO(text: string): string | null {
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!m) return null;
  const month = months[m[1].toLowerCase()];
  const day = m[2].padStart(2, "0");
  const year = m[3];
  return `${year}-${month}-${day}`;
}

function isoToArchiveSlug(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (monthIdx < 0 || monthIdx > 11) return null;
  return `${MONTH_NAMES[monthIdx]}-${day}-${year}`;
}

function extractNumbers(text: string): number[] | null {
  const m = text.match(/(\d{1,2})[\s]*[-–][\s]*(\d{1,2})[\s]*[-–][\s]*(\d{1,2})[\s]*[-–][\s]*(\d{1,2})[\s]*[-–][\s]*(\d{1,2})[\s]*[-–][\s]*(\d{1,2})/);
  if (!m) return null;
  return m.slice(1, 7).map((n) => parseInt(n, 10));
}

function extractJackpot(text: string): string | null {
  const idx = text.indexOf("Jackpot Prize");
  if (idx === -1) return null;
  const m = text.slice(idx, idx + 60).match(/([₱P]\s?[\d,]+(?:\.\d{2})?)/);
  return m ? m[1].replace(/^P\s?/, "₱") : null;
}

// Scan every "Winning Combination" occurrence on the page and, for each,
// find the closest preceding game-label mention within a short window —
// that's the real table this combination belongs to. Anchoring on the
// combination marker (not the label) avoids matching unrelated label
// mentions elsewhere on the page (nav links, "related results", etc.).
function findAllResultTables(text: string): (GameResult & { pos: number })[] {
  const out: (GameResult & { pos: number })[] = [];
  let searchFrom = 0;

  while (true) {
    const wcIdx = text.indexOf("Winning Combination", searchFrom);
    if (wcIdx === -1) break;

    const lookback = 250;
    const windowStart = Math.max(0, wcIdx - lookback);
    const before = text.slice(windowStart, wcIdx);

    let bestGid: string | null = null;
    let bestPos = -1;
    for (const gid of ALL_GAME_IDS) {
      const label = GAME_TABLE_LABELS[gid];
      const labelIdx = before.lastIndexOf(label);
      if (labelIdx !== -1) {
        const absPos = windowStart + labelIdx;
        if (absPos > bestPos) { bestPos = absPos; bestGid = gid; }
      }
    }

    const combWindow = text.slice(wcIdx, wcIdx + 200);
    const numbers = extractNumbers(combWindow);
    const jackpot = extractJackpot(combWindow);

    if (bestGid && numbers) {
      // avoid duplicate entries for the same game (keep the first/closest one found)
      if (!out.some((r) => r.game === bestGid)) {
        out.push({ game: bestGid, gameLabel: GAME_LABELS[bestGid], numbers, jackpot, pos: wcIdx });
      }
    }

    searchFrom = wcIdx + "Winning Combination".length;
  }

  return out;
}

function userAgentHeader() {
  return { "User-Agent": "Mozilla/5.0 (compatible; LottoReviewBot/1.0; +https://lottoreview.pausystems.com)" };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---- Mode 3 (and fallback for mode 2): latest result for one game ----
async function fetchLatest(gameId: string): Promise<{ date: string; result: GameResult; source: string } | null> {
  const slug = GAME_SLUGS[gameId];
  const sourceUrl = `https://www.lottopcso.com/${slug}/`;
  const res = await fetch(sourceUrl, { headers: userAgentHeader() });
  if (!res.ok) return null;

  const text = stripTags(await res.text());
  const tables = findAllResultTables(text);
  if (tables.length === 0) return null;

  // this page is dedicated to one game, so take the first (topmost) table found
  const first = tables.sort((a, b) => a.pos - b.pos)[0];
  const before = text.slice(Math.max(0, first.pos - 250), first.pos);
  const drawDate = parseDateToISO(before);
  if (!drawDate) return null;

  return {
    date: drawDate,
    result: { game: gameId, gameLabel: GAME_LABELS[gameId], numbers: first.numbers, jackpot: first.jackpot },
    source: sourceUrl,
  };
}

async function handleLatest(gameId: string): Promise<Response> {
  const latest = await fetchLatest(gameId);
  if (!latest) {
    return json({ success: false, reason: "Could not fetch or parse the latest result page" }, 502);
  }
  return json({
    success: true,
    date: latest.date,
    results: [latest.result],
    source: latest.source,
    lookupMode: "latest",
  }, 200);
}

// ---- Modes 1 & 2: fetch one date's archive page, parse one or all games ----
async function fetchByDate(isoDate: string, gameId: string | null): Promise<Response> {
  const slug = isoToArchiveSlug(isoDate);
  if (!slug) {
    return json({ success: false, reason: "Invalid date format, expected YYYY-MM-DD" }, 400);
  }

  const sourceUrl = `https://www.lottopcso.com/pcso-lotto-result-${slug}/`;
  const res = await fetch(sourceUrl, { headers: userAgentHeader() });

  let allTables: (GameResult & { pos: number })[] = [];
  const archiveOk = res.ok;
  if (archiveOk) {
    const text = stripTags(await res.text());
    allTables = findAllResultTables(text);
  }

  let results: GameResult[] = gameId
    ? allTables.filter((t) => t.game === gameId)
    : allTables;

  // Fallback: single-game lookup where the archive page failed or didn't have
  // this game yet — try the per-game "latest" page, and use it only if its
  // date actually matches what was requested.
  if (gameId && results.length === 0) {
    const latest = await fetchLatest(gameId);
    if (latest && latest.date === isoDate) {
      return json({
        success: true,
        date: isoDate,
        results: [latest.result],
        source: latest.source,
        lookupMode: "historical-single-fallback",
      }, 200);
    }
  }

  if (gameId && results.length === 0) {
    return json({
      success: false,
      date: isoDate,
      reason: `${GAME_LABELS[gameId]} did not draw on ${isoDate}, or the result isn't published yet.`,
    }, 404);
  }

  if (!gameId && results.length === 0) {
    return json({
      success: false,
      date: isoDate,
      reason: archiveOk ? `No game results found for ${isoDate}.` : `No results archive found for ${isoDate} yet.`,
    }, 404);
  }

  return json({
    success: true,
    date: isoDate,
    results,
    source: sourceUrl,
    lookupMode: gameId ? "historical-single" : "historical-all",
  }, 200);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const gameId = url.searchParams.get("game") || "";
    const requestedDate = url.searchParams.get("date") || "";

    if (gameId && !GAME_SLUGS[gameId]) {
      return json({ success: false, reason: `Unknown game id: ${gameId}` }, 400);
    }

    if (requestedDate) {
      return await fetchByDate(requestedDate, gameId || null);
    }

    if (gameId) {
      return await handleLatest(gameId);
    }

    return json({ success: false, reason: "Provide at least a date or a game." }, 400);
  } catch (err: any) {
    return json({ success: false, reason: String(err?.message || err) }, 500);
  }
});
