import { NextResponse } from "next/server";
import { google } from "googleapis";

// Service account scopes (Sheets)
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// ---- helpers ----
function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function a1Col(n: number) {
  // 1 -> A, 2 -> B ...
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function norm(v: unknown) {
  return (v ?? "").toString().trim();
}

function toNum(v: unknown) {
  const n = Number(norm(v));
  return Number.isFinite(n) ? n : NaN;
}

async function getSheetsClient() {
  const clientEmail = env("GOOGLE_CLIENT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: SCOPES,
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Expected JSON body:
 * {
 *   sheetId: "your_google_sheet_id",
 *   tabName: "Web",
 *   orderType: "queued" | "wishlist",
 *   orderedIgdbIds: string[]
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const sheetId = norm(body.sheetId) || env("GOOGLE_SHEET_ID");
    const tabName = norm(body.tabName) || "Web";
    const orderType = norm(body.orderType);
    const orderedIgdbIds: string[] = Array.isArray(body.orderedIgdbIds)
      ? body.orderedIgdbIds.map((x: any) => norm(x)).filter(Boolean)
      : [];

    if (!sheetId) throw new Error("Missing sheetId (or GOOGLE_SHEET_ID).");
    if (!tabName) throw new Error("Missing tabName.");
    if (!orderType || !["queued", "wishlist"].includes(orderType)) {
      throw new Error(`orderType must be "queued" or "wishlist". Got: ${orderType}`);
    }
    if (!orderedIgdbIds.length) throw new Error("orderedIgdbIds is empty.");

    const ORDER_COL_NAME = orderType === "queued" ? "QueuedOrder" : "WishlistOrder";
    const ID_COL_NAME = "IGDB_ID";

    const sheets = await getSheetsClient();

    // 1) Read header row to find column indexes
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!1:1`,
    });

    const headerRow = (headerRes.data.values?.[0] || []).map((x) => norm(x));
    const idColIdx0 = headerRow.findIndex((h) => h === ID_COL_NAME);
    const orderColIdx0 = headerRow.findIndex((h) => h === ORDER_COL_NAME);

    if (idColIdx0 === -1) throw new Error(`Header "${ID_COL_NAME}" not found on tab "${tabName}".`);
    if (orderColIdx0 === -1) throw new Error(`Header "${ORDER_COL_NAME}" not found on tab "${tabName}".`);

    const idColA1 = a1Col(idColIdx0 + 1);
    const orderColA1 = a1Col(orderColIdx0 + 1);

    // 2) Read IGDB_ID column to map IGDB_ID -> row number
    // (Start at row 2; row 1 is header)
    const idRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${tabName}'!${idColA1}2:${idColA1}`,
    });

    const idValues = (idRes.data.values || []).map((r) => norm(r?.[0]));
    // idValues[i] corresponds to sheet row (i + 2)
    const idToRow = new Map<string, number>();
    idValues.forEach((id, i) => {
      if (id) idToRow.set(id, i + 2);
    });

    // 3) Build batch updates: set order 1..N for ids we can find
    const updates: { range: string; values: any[][] }[] = [];
    const missing: string[] = [];

    orderedIgdbIds.forEach((igdbId, idx) => {
      const rowNum = idToRow.get(igdbId);
      if (!rowNum) {
        missing.push(igdbId);
        return;
      }
      updates.push({
        range: `'${tabName}'!${orderColA1}${rowNum}`,
        values: [[idx + 1]], // 1-based order
      });
    });

    if (!updates.length) {
      throw new Error(
        `No rows matched IGDB_IDs. Example missing: ${missing.slice(0, 5).join(", ")}`
      );
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });

    return NextResponse.json({
      ok: true,
      updated: updates.length,
      missingCount: missing.length,
      missing: missing.slice(0, 25),
      orderType,
      column: ORDER_COL_NAME,
      tabName,
    });
  } catch (err: any) {
    // This makes Vercel logs + browser devtools actually useful
    console.error("update-order error:", err?.message || err, err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
