import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { env } from "next-runtime-env";

import { APP_HOME_PATH } from "./utils/navigation";
import { buildSecurityHeaders } from "./utils/security-headers";

function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const header of buildSecurityHeaders({
    nodeEnv: env("NODE_ENV"),
    posthogHost: env("NEXT_PUBLIC_POSTHOG_HOST"),
    storageEndpoint: env("S3_PUBLIC_ENDPOINT"),
  })) {
    response.headers.set(header.key, header.value);
  }
  return response;
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    if (env("NEXT_PUBLIC_KAN_ENV") !== "cloud") {
      const destination = getSessionCookie(request, { cookiePrefix: "kan" })
        ? APP_HOME_PATH
        : "/login";
      return addSecurityHeaders(
        NextResponse.redirect(new URL(destination, request.url)),
      );
    }
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
