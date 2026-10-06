import { requireUser } from "@/lib/supabase/server";
import { sameOrigin, bodyJson, json, failure } from "@/lib/server/errors";
import { accessCommand } from "@/lib/access-controls";
import {
  prepareAccessAction,
  executeAccessAction,
  changeAccessFactor,
  accessConfirmationMode,
  confirmOwnerAccessAction,
} from "@/lib/server/access-controls";
export async function GET() {
  try {
    const user = await requireUser();
    return json(await accessConfirmationMode(user.id));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser(),
      command = accessCommand.parse(await bodyJson(request, 12000));
    return json(
      command.stage === "owner_confirm"
        ? await confirmOwnerAccessAction(user, command.intent)
        : command.stage === "prepare"
          ? await prepareAccessAction(user, command.intent, command.password)
          : command.stage === "execute"
            ? await executeAccessAction(user, command.intent, {
                code: command.code,
                response: command.response,
              })
            : await changeAccessFactor(
                user,
                command.intent,
                command.stage === "method" ? command.method : undefined,
              ),
    );
  } catch (e) {
    return failure(e);
  }
}
