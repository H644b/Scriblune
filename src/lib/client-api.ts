export async function api<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({
    error: "The connection was interrupted. Your saved work is safe.",
  }));
  if (!response.ok)
    throw new Error(body.error || "Something went wrong. Please try again.");
  return body as T;
}
