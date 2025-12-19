import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function getAuth() {
  const projectId = mustEnv("GOOGLE_PROJECT_ID");
  const clientEmail = mustEnv("GOOGLE_CLIENT_EMAIL");
  const privateKeyRaw = mustEnv("GOOGLE_PRIVATE_KEY");
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
    projectId,
  });
}

/**
 * Body expected:
 * {
 *   sheetId: "your spreadsheet id",
 *   tabName: "Web",
 *   mode: "queued" | "wishlist",
 *   items: [{ igdbId: "123", order: 1 }, ...]
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const sheetId: string = body.sheetId;
    const tabName: string = body.tabName || "Web";
    const mode: "queued" | "wishlist" = body.mode;
    const items: { igdbId: string; order: number }[] = body.items;

    if (!sheetId) throw new Error("Missing body.sheetId");
    if (!mode) throw new Error("Missing body.mode");
    if (!Array.isArray(items) || items.length === 0) throw new Error("Missing body.items");

    // Columns we update based on mode
    const orderHeader = mode === "queued" ? "QueuedOrder" : "WishlistOrder";
    const idHeader = "IGDB_ID";

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Pull header row + IGDB_ID column + order column (we’ll find column indexes by header name)
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!1:1`,
    });

    const headers = (headerRes.data.values?.[0] || []).map((x) => String(x).trim());
    const idColIdx = headers.indexOf(idHeader);
    const orderColIdx = headers.indexOf(orderHeader);

    if (idColIdx === -1) throw new Error(`Header not found: ${idHeader}`);
    if (orderColIdx === -1) throw new Error(`Header not found: ${orderHeader}`);

    // Fetch all rows for mapping IGDB_ID -> row number
    const allRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A2:ZZ`,
    });

    const rows = allRes.data.values || [];
    // Map IGDB_ID -> sheet row number (2-based because A2 is row 2)
    const idToRowNum = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const idVal = String(row[idColIdx] || "").trim();
      if (idVal) idToRowNum.set(idVal, i + 2);
    }

    // Prepare batch updates
    const data: { range: string; values: (string | number)[][] }[] = [];

    for (const it of items) {
      const igdbId = String(it.igdbId || "").trim();
      if (!igdbId) continue;

      const rowNum = idToRowNum.get(igdbId);
      if (!rowNum) continue;

      // Convert column index -> A1 letter
      const colLetter = columnNumberToLetter(orderColIdx + 1);
      data.push({
        range: `${tabName}!${colLetter}${rowNum}`,
        values: [[it.order]],
      });
    }

    if (data.length === 0) {
      return NextResponse.json(
        { ok: true, updated: 0, message: "No matching IGDB_ID rows found to update." },
        { status: 200 }
      );
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });

    return NextResponse.json({ ok: true, updated: data.length }, { status: 200 });
  } catch (err: any) {
    // This makes the actual reason visible in Vercel logs and optionally in the response
    console.error("update-order error:", err?.message || err, err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

function columnNumberToLetter(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
