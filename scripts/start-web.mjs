import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { accessMailEnvironment, superviseWeb } from "./web-processes.mjs";

const cwd = process.cwd();
const server = existsSync(resolve(cwd, "server.js"))
  ? "server.js"
  : ".next/standalone/server.js";
const commands = [{ name: "next", args: [server], cwd, env: process.env }];
if (process.env.ACCOUNT_EMAILS_ENABLED === "true")
  commands.push({
    name: "access_mail",
    args: ["--import", "tsx", "src/server/access-mail.ts"],
    cwd,
    env: accessMailEnvironment(process.env),
  });
superviseWeb(commands);
