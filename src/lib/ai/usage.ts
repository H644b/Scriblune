import type OpenAI from "openai";

// Server logs only: never include prompts, images, account IDs, or provider errors.
// Missing usage (e.g. a disconnected stream) is unknown, not zero-cost.
export function recordUsage(
  operation: string,
  response: Pick<
    OpenAI.Responses.Response,
    "id" | "model" | "status" | "usage"
  >,
  context: { turnId?: string; round?: number } = {},
) {
  const usage = response.usage;
  console.info(
    JSON.stringify({
      event: "ai_usage",
      operation,
      response_id: response.id,
      model: response.model,
      status: response.status,
      turn_id: context.turnId,
      round: context.round,
      input_tokens: usage?.input_tokens ?? null,
      cached_input_tokens: usage?.input_tokens_details?.cached_tokens ?? null,
      cache_write_tokens:
        usage?.input_tokens_details?.cache_write_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      reasoning_tokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
    }),
  );
}
