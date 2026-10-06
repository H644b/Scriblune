import { z } from "zod";

const size = {
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
};
const id = z.uuid();
export const consoleRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), ...size }).strict(),
  z
    .object({ action: z.literal("read"), id, cursor: z.number().int().min(0) })
    .strict(),
  z
    .object({
      action: z.literal("input"),
      id,
      sequence: z.number().int().min(1),
      data: z
        .string()
        .min(1)
        .max(10924)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
    })
    .strict(),
  z.object({ action: z.literal("resize"), id, ...size }).strict(),
  z.object({ action: z.literal("close"), id }).strict(),
]);
export type ConsoleRequest = z.infer<typeof consoleRequest>;
export type ConsoleOutput = {
  chunks: { sequence: number; data: string }[];
  closed: boolean;
  reason: string | null;
};
