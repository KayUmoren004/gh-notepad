import { NextResponse } from "next/server";
import { clearTokenCookie } from "@/lib/github-auth";

export async function POST() {
  await clearTokenCookie();

  return NextResponse.json({ success: true });
}
