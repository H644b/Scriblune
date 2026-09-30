import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "@/lib/server/errors";
export async function serverAuth() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          try {
            for (const { name, value, options } of items)
              jar.set(name, value, options);
          } catch {
            /* Read-only rendering; proxy handles refresh. */
          }
        },
      },
    },
  );
}
export async function requireUser() {
  const client = await serverAuth();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.is_anonymous)
    throw new AppError(
      401,
      "Sign in to open your private workspace.",
      "AUTH_REQUIRED",
    );
  if (!data.user.email_confirmed_at)
    throw new AppError(
      403,
      "Verify your email before starting a session.",
      "VERIFICATION_REQUIRED",
    );
  return data.user;
}
