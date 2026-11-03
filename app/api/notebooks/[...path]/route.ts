import type { NextRequest } from "next/server";
import { notebookApiFromEnv } from "@/lib/notebook-api";

// Every notebook route is answered by the notebook API, which routes by path (see lib/notebook-api).

export function GET(request: NextRequest) {
  return notebookApiFromEnv().handle(request);
}

export function POST(request: NextRequest) {
  return notebookApiFromEnv().handle(request);
}

export function DELETE(request: NextRequest) {
  return notebookApiFromEnv().handle(request);
}
