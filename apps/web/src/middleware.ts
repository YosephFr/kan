import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { env } from "next-runtime-env";

import { APP_HOME_PATH } from "./utils/navigation";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    if (env("NEXT_PUBLIC_KAN_ENV") !== "cloud") {
      const destination = getSessionCookie(request) ? APP_HOME_PATH : "/login";
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
