import { NextResponse } from "next/server";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { igdbId, orderValue, sheetName, orderColumn } = body;

    if (!igdbId || orderValue == null) {
      return NextResponse.json(
        { error: "Missing igdbId or orderValue" },
        { status: 400 }
      );
    }

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      undefined,
      process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      SCOPES
    );

    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = process.env.GOOGLE_PROJECT_ID;

    // Read the sheet to find the row with matching IGDB_ID
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = readRes.data.values || [];
    const header = rows[0];
    const igdbColIndex = header.indexOf("IGDB_ID");
    const orderColIndex = header.indexOf(orderColumn);

    if (igdbColIndex === -1 || orderColIndex === -1) {
      return NextResponse.json(
        { error: "Required column not found" },
        { status: 400 }
      );
    }

    const rowIndex = rows.findIndex(
      (row, i) => i > 0 && row[igdbColIndex] === String(igdbId)
    );

    if (rowIndex === -1) {
      return NextResponse.json(
        { error: "IGDB_ID not found" },
        { status: 404 }
      );
    }

    const cell = `${sheetName}!${String.fromCharCode(
      65 + orderColIndex
    )}${rowIndex + 1}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cell,
      valueInputOption: "RAW",
      requestBody: {
        values: [[orderValue]],
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
