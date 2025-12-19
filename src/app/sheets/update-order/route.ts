import { NextResponse } from "next/server";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getSheetsClient() {
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env vars.");
  }

  const auth = new google.auth.GoogleAuth({
    projectId,
    scopes: SCOPES,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });

  return google.sheets({ version: "v4", auth });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // TODO: keep your existing body parsing here (sheetId, tabName, igdbId, column, newOrder, etc)
    // For now this is just the auth + compile fix.
    // Example placeholders:
    const spreadsheetId = body.spreadsheetId as string;
    const sheetName = body.sheetName as string; // e.g. "Web"
    const range = body.range as string;         // e.g. "Web!B2:B2"
    const value = body.value;                   // e.g. 12

    if (!spreadsheetId || !sheetName || !range) {
      return NextResponse.json({ error: "Missing spreadsheetId/sheetName/range" }, { status: 400 });
    }

    const sheets = getSheetsClient();

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
