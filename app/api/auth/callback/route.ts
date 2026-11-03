import type { NextRequest } from "next/server";
import { authFromEnv } from "@/lib/auth";

export function GET(request: NextRequest) {
  return authFromEnv().callback(request);
}
