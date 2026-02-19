import { NextResponse } from "next/server";

// Health check - should NOT be flagged for rate limiting
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
