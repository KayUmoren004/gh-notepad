import type { NextRequest } from "next/server";
import { sharedNotebooksApiFromEnv } from "@/lib/shared-notebooks-api";

export function DELETE(request: NextRequest) {
  return sharedNotebooksApiFromEnv().handle(request);
}
