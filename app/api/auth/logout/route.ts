import type { NextRequest } from "next/server";
import { authFromEnv } from "@/lib/auth";

export function POST(request: NextRequest) {
  return authFromEnv().signOut(request);
}
