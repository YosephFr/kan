export interface KanConfig {
  baseUrl: string;
  apiToken: string;
  adminApiKey?: string;
  requestTimeoutMs: number;
}

export function getConfig(): KanConfig {
  const baseUrl = process.env.KAN_BASE_URL;
  const apiToken = process.env.KAN_API_TOKEN;

  if (!baseUrl) {
    throw new Error("KAN_BASE_URL environment variable is required");
  }
  if (!apiToken) {
    throw new Error("KAN_API_TOKEN environment variable is required");
  }

  const parsedBaseUrl = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new Error("KAN_BASE_URL must use http or https");
  }

  const configuredTimeout = Number.parseInt(
    process.env.KAN_REQUEST_TIMEOUT_MS ?? "30000",
    10,
  );
  const adminApiKey = process.env.KAN_ADMIN_API_KEY;

  return {
    baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    apiToken,
    adminApiKey:
      adminApiKey && adminApiKey.length > 0 ? adminApiKey : undefined,
    requestTimeoutMs:
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 30000,
  };
}

export class KanApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown,
  ) {
    super(`Kan API error ${status} ${statusText}: ${JSON.stringify(body)}`);
    this.name = "KanApiError";
  }
}

export interface KanRequestOptions {
  token?: string;
  retry?: boolean;
  headers?: Record<string, string>;
}

const retryableMethods = new Set(["GET", "HEAD", "PUT", "DELETE"]);
const retryableStatuses = new Set([429, 502, 503, 504]);

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number.parseFloat(
    response.headers.get("retry-after") ?? "",
  );
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, 5000);
  }
  return Math.min(200 * 2 ** attempt, 1000);
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  if (
    (response.headers.get("content-type") ?? "").includes("application/json")
  ) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function kanRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options: KanRequestOptions = {},
): Promise<T> {
  const config = getConfig();
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Kan API paths must start with a single slash");
  }

  const url = `${config.baseUrl}/api/v1${path}`;
  const normalizedMethod = method.toUpperCase();
  const sendsJson = !["GET", "HEAD"].includes(normalizedMethod);
  const canRetry =
    options.retry !== false && retryableMethods.has(normalizedMethod);
  const attempts = canRetry ? 3 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: normalizedMethod,
        headers: {
          ...(sendsJson ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${options.token ?? config.apiToken}`,
          ...options.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
    } catch (error) {
      if (canRetry && attempt < attempts - 1) {
        await wait(200 * 2 ** attempt);
        continue;
      }
      throw new Error(
        `Kan API request failed for ${normalizedMethod} ${path}`,
        {
          cause: error,
        },
      );
    }

    const data = await parseResponse(response);

    if (response.ok) {
      return data as T;
    }

    if (
      canRetry &&
      retryableStatuses.has(response.status) &&
      attempt < attempts - 1
    ) {
      await wait(retryDelay(response, attempt));
      continue;
    }

    throw new KanApiError(response.status, response.statusText, data);
  }

  throw new Error(
    `Kan API request exhausted retries for ${normalizedMethod} ${path}`,
  );
}

export async function kanAdminRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const config = getConfig();
  if (!config.adminApiKey) {
    throw new Error("KAN_ADMIN_API_KEY environment variable is required");
  }
  return kanRequest<T>(method, path, body, {
    headers: { "x-admin-api-key": config.adminApiKey },
  });
}

export async function putBinary(
  url: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const config = getConfig();
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Upload URLs must use http or https");
  }

  const response = await fetch(parsedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: data,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    throw new KanApiError(
      response.status,
      response.statusText,
      await parseResponse(response),
    );
  }
}
