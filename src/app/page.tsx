import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs"; // IMPORTANT: must run on Node (not Edge)

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKeyRaw) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  // ✅ Correct constructor form for your googleapis types
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_TAB ?? "Web"; // you said tab name is Web

    if (!spreadsheetId) {
      return NextResponse.json({ error: "Missing GOOGLE_SHEET_ID" }, { status: 500 });
    }

    // Expected payload shape (example):
    // { igdbId: "123", column: "QueuedOrder", value: 7 }
    const igdbId = String(body.igdbId ?? "").trim();
    const column = String(body.column ?? "").trim(); // "QueuedOrder" or "WishlistOrder"
    const value = Number(body.value);

    if (!igdbId || !column || !Number.isFinite(value)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // 1) Read header row so we can find the column index by name
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`,
    });

    const headers = (headerRes.data.values?.[0] ?? []).map((h) => String(h).trim());
    const colIndex = headers.findIndex((h) => h === column);
    const igdbColIndex = headers.findIndex((h) => h === "IGDB_ID");

    if (igdbColIndex === -1) {
      return NextResponse.json({ error: "IGDB_ID column not found" }, { status: 500 });
    }
    if (colIndex === -1) {
      return NextResponse.json({ error: `${column} column not found` }, { status: 500 });
    }

    // 2) Find the row where IGDB_ID matches
    const igdbRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${toA1Col(igdbColIndex + 1)}2:${toA1Col(igdbColIndex + 1)}`,
    });

    const igdbValues = igdbRes.data.values ?? [];
    const rowOffset = igdbValues.findIndex((r) => String(r?.[0] ?? "").trim() === igdbId);
    if (rowOffset === -1) {
      return NextResponse.json({ error: `IGDB_ID ${igdbId} not found` }, { status: 404 });
    }

    const rowNumber = 2 + rowOffset; // because we started at row 2
    const targetA1 = `${sheetName}!${toA1Col(colIndex + 1)}${rowNumber}`;

    // 3) Update that single cell
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: targetA1,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    });

    return NextResponse.json({ ok: true, updated: targetA1 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

// Helper: 1 -> A, 2 -> B, ... 27 -> AA
function toA1Col(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
