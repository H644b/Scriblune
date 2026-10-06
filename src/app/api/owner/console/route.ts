import { consoleRequest } from "@/lib/console-protocol";
import {
  requireConsoleOwner,
  auditConsole,
  consoleIdentity,
  assertConsoleOwner,
} from "@/lib/server/console-auth";
import { consoleConfigured, vmConsole } from "@/lib/server/vm-console";
import { bodyJson, failure, json, sameOrigin } from "@/lib/server/errors";
import { rateLimit } from "@/lib/server/email-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireConsoleOwner();
    return json({ configured: consoleConfigured() });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = consoleRequest.parse(await bodyJson(request, 12_000));
    const identity =
      b.action === "open"
        ? await requireConsoleOwner()
        : await consoleIdentity();
    // Reads authorize immediately before releasing output, after any long poll.
    if (b.action !== "open" && b.action !== "read")
      await assertConsoleOwner(identity);
    switch (b.action) {
      case "open": {
        await rateLimit(`console:${identity.accountId}`, 10, 300);
        const opened = await vmConsole.open(identity, b.cols, b.rows);
        return json(opened);
      }
      case "read":
        return json(
          await vmConsole.read(b.id, identity, b.cursor, request.signal),
        );
      case "input":
        vmConsole.input(b.id, identity, b.sequence, b.data);
        break;
      case "resize":
        vmConsole.resize(b.id, identity, b.cols, b.rows);
        break;
      case "close":
        vmConsole.close(b.id, identity);
        // Await a durable user-requested disconnect event before acknowledging it.
        await auditConsole(identity, "console.disconnect", { session: b.id });
    }
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
