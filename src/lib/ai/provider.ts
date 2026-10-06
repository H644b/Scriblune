import OpenAI from "openai";
import { z } from "zod";
import { requireAI } from "../server/config";
import { recordUsage } from "./usage";
export type UsageContext = {
  operation: "ledger" | "index" | "review" | "rubric";
  turnId?: string;
};
export interface StructuredProvider {
  structured<T>(
    kind: "tutor" | "review",
    instructions: string,
    input: OpenAI.Responses.ResponseInput,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    usageContext?: UsageContext,
  ): Promise<T>;
}
export function client() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 90_000,
    maxRetries: 1,
  });
}
export function model(kind: "tutor" | "review") {
  requireAI(kind);
  return (
    kind === "tutor" ? process.env.AI_TUTOR_MODEL : process.env.AI_REVIEW_MODEL
  )!;
}
export function jsonSchema(schema: z.ZodType) {
  const s = z.toJSONSchema(schema, { target: "draft-7" });
  delete s.$schema;
  return s as Record<string, unknown>;
}
export const provider: StructuredProvider = {
  async structured<T>(
    kind: "tutor" | "review",
    instructions: string,
    input: OpenAI.Responses.ResponseInput,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    usageContext?: UsageContext,
  ) {
    const response = await client().responses.create(
      {
        model: model(kind),
        instructions,
        input,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "result",
            strict: true,
            schema: jsonSchema(schema),
          },
        },
        max_output_tokens: 6500,
      },
      { signal },
    );
    recordUsage(
      usageContext?.operation || `structured_${kind}`,
      response,
      usageContext,
    );
    if (response.status !== "completed")
      throw new Error("The model did not complete its structured response.");
    return schema.parse(JSON.parse(response.output_text));
  },
};
