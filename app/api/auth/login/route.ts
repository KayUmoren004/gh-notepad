import { NextResponse } from "next/server";
import { getGitHubAuthUrl } from "@/lib/github-auth";

export async function GET() {
  const authUrl = getGitHubAuthUrl();
  return NextResponse.redirect(authUrl);
}
