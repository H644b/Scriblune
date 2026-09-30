import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export const requireValue = (
  condition: unknown,
  status: number,
  message: string,
): asserts condition => {
  if (!condition) throw new AppError(status, message);
};
export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Cookie",
};
export function failure(error: unknown) {
  if (error instanceof AppError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: privateHeaders },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        error:
          "Some fields are missing or invalid. Check your input and try again.",
        code: "INVALID_INPUT",
      },
      { status: 400, headers: privateHeaders },
    );
  // Never log document content, SQL parameters, provider payloads, or credentials.
  return Response.json(
    {
      error:
        "This service is unavailable right now. Your saved work is safe. Please retry.",
      code: "UNAVAILABLE",
    },
    { status: 503, headers: privateHeaders },
  );
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  );
  let allowed = origin === expected.origin;
  if (origin && process.env.NODE_ENV === "development") {
    try {
      const parsed = new URL(origin);
      allowed ||=
        ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
        ["localhost", "127.0.0.1"].includes(expected.hostname) &&
        parsed.port === expected.port &&
        parsed.protocol === expected.protocol;
    } catch {}
  }
  if (!allowed)
    throw new AppError(
      403,
      "This request must come from your Scriblune workspace.",
    );
}

export async function readLimited(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError(413, "This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new AppError(413, "This request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
export async function bodyJson(request: Request, limit = 300_000) {
  try {
    return JSON.parse(
      new TextDecoder().decode(await readLimited(request, limit)),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "Could not read this request.");
  }
}
