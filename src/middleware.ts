import { NextResponse } from "next/server";

// TEMPORARY: middleware disabled to isolate session/token issue
export function middleware() {
  return NextResponse.next();
}
