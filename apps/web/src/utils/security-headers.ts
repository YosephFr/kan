function safeOrigin(
  value: string | undefined,
  allowInsecure: boolean,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.protocol === "https:" ||
      (allowInsecure && url.protocol === "http:")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function buildSecurityHeaders(input: {
  nodeEnv: string | undefined;
  posthogHost: string | undefined;
  storageEndpoint: string | undefined;
}): { key: string; value: string }[] {
  const isProduction = input.nodeEnv === "production";
  const isDevelopment = input.nodeEnv === "development";
  const posthogOrigin = safeOrigin(input.posthogHost, !isProduction);
  const storageOrigin = safeOrigin(input.storageEndpoint, !isProduction);
  const scriptSources = ["'self'", "'unsafe-inline'", "https://cloud.umami.is"];
  if (posthogOrigin) scriptSources.push(posthogOrigin);
  if (isDevelopment) scriptSources.push("'unsafe-eval'");
  const connectSources = [
    "'self'",
    "https://www.youtube.com",
    "https://cloud.umami.is",
  ];
  if (posthogOrigin) connectSources.push(posthogOrigin);
  if (storageOrigin) connectSources.push(storageOrigin);
  if (isDevelopment) connectSources.push("ws:", "wss:");

  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "frame-src 'self' https://docs.google.com https://drive.google.com https://www.youtube.com",
    `img-src 'self' data: blob: https:${isProduction ? "" : " http:"}`,
    `media-src 'self' blob: https:${isProduction ? "" : " http:"}`,
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Content-Type-Options", value: "nosniff" },
  ];
}
