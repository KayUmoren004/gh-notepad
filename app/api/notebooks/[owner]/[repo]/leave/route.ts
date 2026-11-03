import type { NextRequest } from "next/server";
import { sharedNotebooksApiFromEnv } from "@/lib/shared-notebooks-api";

export function POST(request: NextRequest) {
  return sharedNotebooksApiFromEnv().handle(request);
}
