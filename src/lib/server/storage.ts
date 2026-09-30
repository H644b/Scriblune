import { createClient } from "@supabase/supabase-js";
import { AppError } from "./errors";
export const BUCKET = "scriblune-private";
export function storage() {
  if (!process.env.SUPABASE_SECRET_KEY)
    throw new AppError(
      503,
      "Private file storage has not been configured.",
      "STORAGE_NOT_CONFIGURED",
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).storage.from(BUCKET);
}
export async function storeFile(path: string, data: Uint8Array, mime: string) {
  const { error } = await storage().upload(path, data, {
    contentType: mime,
    upsert: false,
    cacheControl: "0",
  });
  if (error) throw new AppError(503, "Could not save this file. Please retry.");
}
export async function getFile(path: string) {
  const { data, error } = await storage().download(path);
  if (error || !data)
    throw new AppError(503, "Could not load this file. Please retry.");
  return new Uint8Array(await data.arrayBuffer());
}
