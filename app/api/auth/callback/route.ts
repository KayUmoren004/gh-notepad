import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, setTokenCookie } from "@/lib/github-auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("GitHub OAuth error:", error);
    return NextResponse.redirect(`${APP_URL}?error=auth_failed`);
  }

  if (!code) {
    return NextResponse.redirect(`${APP_URL}?error=no_code`);
  }

  const token = await exchangeCodeForToken(code);

  if (!token) {
    return NextResponse.redirect(`${APP_URL}?error=token_exchange_failed`);
  }

  await setTokenCookie(token);

  return NextResponse.redirect(`${APP_URL}/notes`);
}
