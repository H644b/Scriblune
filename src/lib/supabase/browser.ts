import { createBrowserClient } from "@supabase/ssr";
export function browserAuth() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        secure:
          process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") === true,
      },
    },
  );
}
