import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs"; // IMPORTANT: Blob requires Node, not Edge

export async function POST(req: NextRequest) {
  try {
    const { title, coverUrl } = await req.json();

    if (!coverUrl) {
      return NextResponse.json(
        { error: "Missing coverUrl" },
        { status: 400 }
      );
    }

    // Fetch image from IGDB
    const imageRes = await fetch(coverUrl);
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch image" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await imageRes.arrayBuffer());

    // Clean filename
    const safeTitle = (title || "game")
      .replace(/[\\/:*?"<>|]+/g, "")
      .slice(0, 100);

    // Upload to Vercel Blob
    const blob = await put(
      `covers/${safeTitle}.jpg`,
      buffer,
      {
        access: "public",
        contentType: imageRes.headers.get("content-type") || "image/jpeg",
      }
    );

    return NextResponse.json({
      url: blob.url,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
