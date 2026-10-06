import { requireUser } from "../supabase/server";
import { AppError } from "./errors";
import { GUEST } from "./forum";
export async function optionalForumAccount() {
  try {
    return (await requireUser()).id;
  } catch (e) {
    if (e instanceof AppError && [401, 403].includes(e.status)) return GUEST;
    throw e;
  }
}
