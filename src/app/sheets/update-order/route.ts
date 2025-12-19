import { NextResponse } from "next/server";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const SHEET_ID = process.env.GOOGLE_SHEET_ID; // put your spreadsheet ID in Vercel env
const SHEET_TAB = "Web"; // your tab name

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function colToA1(colIndex1Based: number) {
  let n = colIndex1Based;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function getSheetsClient() {
  const clientEmail = mustEnv("GOOGLE_CLIENT_EMAIL");
  const privateKey = mustEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });

  return google.sheets({ version: "v4", auth });
}

type Body = {
  orderColumn: "QueuedOrder" | "WishlistOrder";
  items: { igdbId: string; order: number }[];
};

export async function POST(req: Request) {
  try {
    if (!SHEET_ID) throw new Error("Missing env var: GOOGLE_SHEET_ID");

    const body = (await req.json()) as Body;

    if (!body?.orderColumn || !Array.isArray(body.items)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const sheets = await getSheetsClient();

    // 1) Read header row to find column indexes
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!1:1`,
    });

    const headers = (headerRes.data.values?.[0] ?? []).map((x) => String(x).trim());
    const igdbCol = headers.indexOf("IGDB_ID") + 1;
    const orderCol = headers.indexOf(body.orderColumn) + 1;

    if (igdbCol <= 0) throw new Error(`Header not found: IGDB_ID`);
    if (orderCol <= 0) throw new Error(`Header not found: ${body.orderColumn}`);

    // 2) Read IGDB_ID column for all rows so we can map id -> row number
    const igdbColA1 = colToA1(igdbCol);
    const igdbIdsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!${igdbColA1}:${igdbColA1}`,
    });

    const igdbColValues = igdbIdsRes.data.values ?? [];
    // Row 1 is header; data starts at row 2
    const idToRow = new Map<string, number>();
    for (let r = 2; r <= igdbColValues.length; r++) {
      const val = String(igdbColValues[r - 1]?.[0] ?? "").trim();
      if (val) idToRow.set(val, r);
    }

    // 3) Build batch update ranges for order column
    const orderColA1 = colToA1(orderCol);

    const data = body.items
      .map((it) => {
        const row = idToRow.get(String(it.igdbId).trim());
        if (!row) return null;
        return {
          range: `${SHEET_TAB}!${orderColA1}${row}`,
          values: [[it.order]],
        };
      })
      .filter(Boolean) as { range: string; values: (string | number)[][] }[];

    if (!data.length) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data,
      },
    });

    return NextResponse.json({ ok: true, updated: data.length });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
