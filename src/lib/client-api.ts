import { notifyVpnBlocked } from "./network-policy";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
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
  if (!response.ok) {
    notifyVpnBlocked(body);
    throw new ApiError(
      body.error || "Something went wrong. Please try again.",
      response.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }
  return body as T;
}
