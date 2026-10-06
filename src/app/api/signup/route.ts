import { json, failure } from "@/lib/server/errors";
import { signupSettings } from "@/lib/server/signup-access";
export async function GET() {
  try {
    return json(await signupSettings());
  } catch (e) {
    return failure(e);
  }
}
