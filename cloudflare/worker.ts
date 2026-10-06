export interface Env {
  APP_ORIGIN: string;
  APP_PUBLIC_URL: string;
  ORIGIN_AUTH_SECRET: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.APP_ORIGIN || !env.APP_PUBLIC_URL || !env.ORIGIN_AUTH_SECRET)
      return new Response("Deployment configuration is incomplete.", {
        status: 503,
      });
    const publicURL = new URL(env.APP_PUBLIC_URL),
      url = new URL(request.url),
      origin = new URL(env.APP_ORIGIN);
    if (url.origin !== publicURL.origin)
      return Response.redirect(
        new URL(url.pathname + url.search, publicURL).href,
        308,
      );
    if (origin.protocol !== "https:" || origin.host === url.host)
      return new Response("Invalid origin configuration.", { status: 503 });
    origin.pathname = url.pathname;
    origin.search = url.search;
    const headers = new Headers(request.headers);
    headers.set("X-Scriblune-Origin", env.ORIGIN_AUTH_SECRET);
    headers.set(
      "X-Scriblune-Client-IP",
      request.headers.get("CF-Connecting-IP") || "unknown",
    );
    headers.set("X-Forwarded-Host", publicURL.host);
    headers.set("X-Forwarded-Proto", "https");
    headers.delete("Host");
    try {
      const response = await fetch(origin, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "manual",
      });
      const result = new Response(response.body, response);
      const location = result.headers.get("Location");
      if (location) {
        const target = new URL(location, origin);
        if (target.origin === origin.origin)
          result.headers.set(
            "Location",
            new URL(target.pathname + target.search, publicURL).href,
          );
      }
      result.headers.delete("X-Scriblune-Origin");
      result.headers.set("X-Content-Type-Options", "nosniff");
      result.headers.set("Strict-Transport-Security", "max-age=31536000");
      return result;
    } catch {
      return new Response(
        "Scriblune is reconnecting. Please retry shortly. Your saved work is safe.",
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "10" },
        },
      );
    }
  },
};
