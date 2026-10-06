import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { accountTx, ownedSession, type Tx } from "./db";
import { AppError } from "./errors";
import {
  lockBilling,
  reserveUsage,
  refundPrompt,
  usageInTx,
  readUsageInTx,
} from "./usage";
import { hasQuizAccess, type PlanKey } from "../plans";
import {
  generatedQuiz,
  scoreQuiz,
  type Quiz,
  type QuizConfig,
  type QuizQuestion,
} from "../quiz";

type Row = Quiz & {
  account_id: string;
  request_hash: string;
  questions: QuizQuestion[];
};
function requireQuizEntitlement(plan: PlanKey) {
  if (!hasQuizAccess(plan))
    throw new AppError(
      403,
      "Practice quizzes are included with Plus, Focus and Flexible. Your saved quizzes are kept; choose Plus or above to open or continue them.",
      "QUIZ_PLAN_REQUIRED",
    );
}
// Reject ineligible uploads before parsing PDFs; creation rechecks under the
// billing lock, so a stale client or intervening downgrade cannot reserve a quiz.
export async function requireQuizPlan(account: string) {
  return accountTx(
    account,
    async (tx) => {
      requireQuizEntitlement((await readUsageInTx(tx, account)).plan.key);
    },
    { readOnlySnapshot: true },
  );
}
async function requireQuizPlanInTx(tx: Tx, account: string) {
  requireQuizEntitlement((await usageInTx(tx, account)).plan.key);
}
function visible(row: Row): Quiz {
  return {
    id: row.id,
    title: row.title,
    difficulty: row.difficulty,
    question_count: row.question_count,
    status: row.status,
    updated_at: row.updated_at,
    created_at: row.created_at,
    correct_count: row.status === "completed" ? row.correct_count : null,
    answered: row.answers.filter((a) => a !== null).length,
    revision: row.revision,
    error: row.error,
    sources: row.sources,
    answers: row.answers,
    questions: row.questions.map((q) =>
      row.status === "completed" ? q : { prompt: q.prompt, options: q.options },
    ),
  };
}
async function owned(tx: Tx, id: string) {
  const [row] = await tx<
    Row[]
  >`select * from private.practice_quizzes where id=${id} for update`;
  if (!row) throw new AppError(404, "This quiz was not found.");
  return row;
}
async function expire(tx: Tx, account: string) {
  // A terminated process must never cause an automatic second paid request.
  const rows =
    await tx`update private.practice_quizzes set status='failed',error='Generation was interrupted. Your credit was returned; create a new quiz to try again.',updated_at=now()
    where account_id=${account} and status='generating' and created_at<now()-interval '5 minutes' returning id`;
  for (const row of rows) await refundPrompt(tx, account, row.id);
}
export async function listQuizzes(account: string) {
  return accountTx(account, async (tx) => {
    const allowed = hasQuizAccess((await usageInTx(tx, account)).plan.key);
    await expire(tx, account);
    return tx`select id,title,difficulty,question_count,status,case when ${allowed} then correct_count else null end as correct_count,created_at,updated_at,${!allowed}::boolean as locked,
      (select count(*)::int from jsonb_array_elements(answers) a where a<>'null'::jsonb) as answered
      from private.practice_quizzes where account_id=${account} order by updated_at desc,id limit 100`;
  });
}
export async function readQuiz(account: string, id: string) {
  return accountTx(account, async (tx) => {
    await requireQuizPlanInTx(tx, account);
    await expire(tx, account);
    return visible(await owned(tx, id));
  });
}
export async function createQuiz(
  account: string,
  config: QuizConfig,
  hash: string,
  pdfPages: number,
  fileNames: string[],
) {
  return accountTx(account, async (tx) => {
    await requireQuizPlanInTx(tx, account);
    await expire(tx, account);
    const [prior] =
      await tx`select id,request_hash from private.practice_quizzes where id=${config.id}`;
    if (prior) {
      if (prior.request_hash !== hash)
        throw new AppError(
          409,
          "This quiz request has changed. Start a new quiz.",
        );
      return { id: prior.id as string, created: false };
    }
    if (
      (
        await tx`select reference_id from private.usage_ledger where account_id=${account} and kind='prompt' and reference_id=${config.id}`
      ).length
    )
      throw new AppError(
        409,
        "This request ID belongs to another tutor activity. Start a new quiz.",
      );
    const titles: string[] = [];
    let pages = pdfPages;
    for (const id of config.sessions) {
      const session = await ownedSession(tx, id);
      const [count] =
        await tx`select count(*)::int as n from public.document_pages where session_id=${id}`;
      const [processing] =
        await tx`select count(*)::int as n from public.documents where session_id=${id} and status in ('uploading','queued','processing')`;
      if (processing.n)
        throw new AppError(
          409,
          "Wait for your session documents to finish processing first.",
        );
      pages += count.n;
      titles.push(session.title);
    }
    if (pages > 12)
      throw new AppError(
        422,
        "Choose sources with at most 12 pages in total. Upload a shorter PDF excerpt for a focused quiz.",
      );
    if (!titles.length && !fileNames.length)
      throw new AppError(400, "Choose a previous session or upload a PDF.");
    const [active] =
      await tx`select count(*)::int as n from private.practice_quizzes where account_id=${account} and status='generating'`;
    if (active.n >= 2)
      throw new AppError(
        429,
        "Wait for your current quizzes to finish generating.",
      );
    await reserveUsage(tx, account, "prompt", config.id);
    await tx`insert into private.practice_quizzes(id,account_id,title,difficulty,question_count,request_hash,sources)
      values(${config.id},${account},${config.title},${config.difficulty},${config.count},${hash},${tx.json([...titles, ...fileNames])})`;
    return { id: config.id, created: true };
  });
}
export async function generateQuiz(
  account: string,
  config: QuizConfig,
  generate: () => Promise<unknown>,
) {
  const claimed = await accountTx(account, async (tx) => {
    const usage = await usageInTx(tx, account);
    if (!hasQuizAccess(usage.plan.key)) {
      const stopped =
        await tx`update private.practice_quizzes set status='failed',error='Your plan changed before generation started. Your credit was returned. Plus or above is required to generate a quiz.',updated_at=now() where id=${config.id} and status='generating' and not generation_started returning id`;
      if (stopped.length) await refundPrompt(tx, account, config.id);
      return [];
    }
    return tx`update private.practice_quizzes set generation_started=true where id=${config.id} and status='generating' and not generation_started returning id`;
  });
  if (!claimed.length) return;
  try {
    const result = generatedQuiz.parse(await generate());
    if (result.questions.length !== config.count)
      throw new Error("Incorrect question count");
    const prompts = new Set<string>();
    for (const question of result.questions) {
      const normalize = (s: string) =>
        s.trim().toLocaleLowerCase().replace(/\s+/g, " ");
      const key = normalize(question.prompt);
      if (
        prompts.has(key) ||
        new Set(question.options.map(normalize)).size !== 4
      )
        throw new Error("Duplicate question or options");
      prompts.add(key);
      const answer = question.options[question.correct];
      for (let i = 3; i > 0; i--) {
        const j = randomInt(i + 1);
        [question.options[i], question.options[j]] = [
          question.options[j],
          question.options[i],
        ];
      }
      question.correct = question.options.indexOf(answer);
    }
    await accountTx(account, async (tx) => {
      await tx`update private.practice_quizzes set status='in_progress',questions=${tx.json(result.questions)},answers=${tx.json(Array(config.count).fill(null))},updated_at=now()
        where id=${config.id} and status='generating'`;
    });
  } catch {
    await accountTx(account, async (tx) => {
      await lockBilling(tx, account);
      const failed =
        await tx`update private.practice_quizzes set status='failed',error='We could not finish a reliable quiz. Your credit was returned; create a new quiz to try again.',updated_at=now() where id=${config.id} and status='generating' returning id`;
      if (failed.length) await refundPrompt(tx, account, config.id);
    });
    console.info(
      JSON.stringify({ event: "quiz_generation_failed", quiz_id: config.id }),
    );
  }
}
export const quizAnswerChange = z
  .object({
    revision: z.number().int().nonnegative(),
    answers: z.array(z.number().int().min(0).max(3).nullable()).min(1).max(20),
    submit: z.boolean(),
  })
  .strict();
export async function saveQuiz(
  account: string,
  id: string,
  change: z.infer<typeof quizAnswerChange>,
) {
  return accountTx(account, async (tx) => {
    await requireQuizPlanInTx(tx, account);
    const quiz = await owned(tx, id);
    const same =
      JSON.stringify(change.answers) === JSON.stringify(quiz.answers);
    if (quiz.status === "completed" && change.submit && same)
      return visible(quiz);
    if (quiz.status !== "in_progress")
      throw new AppError(409, "This quiz is not open for answers.");
    if (change.answers.length !== quiz.question_count)
      throw new AppError(400, "The answer count does not match this quiz.");
    if (quiz.revision !== change.revision && !same)
      throw new AppError(
        409,
        "This quiz was changed in another tab. Reload its saved answers before continuing.",
      );
    let score: number | null = null;
    if (change.submit) {
      try {
        score = scoreQuiz(quiz.questions, change.answers).correct;
      } catch (e) {
        throw new AppError(400, (e as Error).message);
      }
    }
    if (same && !change.submit) return visible(quiz);
    const [saved] = await tx<
      Row[]
    >`update private.practice_quizzes set answers=${tx.json(change.answers)},revision=revision+1,
      status=${change.submit ? "completed" : "in_progress"},correct_count=${score},completed_at=${change.submit ? new Date() : null},updated_at=now() where id=${id} returning *`;
    return visible(saved);
  });
}
