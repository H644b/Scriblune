import { test, expect } from "@playwright/test";
import { planFor, type PlanKey } from "../../src/lib/plans";
const quizId = "10000000-0000-4000-8000-000000000005";
const billing = (key: PlanKey) => ({
  plan: planFor(key),
  source: key === "free" ? "free" : "owner",
  credits: { included: 5, bonus: 20, available: 25 },
  prompts: { used: 0, limit: 5, remaining: 25 },
  sessions: { used: 0, limit: 1, remaining: 1 },
  checkoutAvailable: false,
});
const denied = {
  status: 403,
  json: { error: "Quizzes require Plus or above.", code: "QUIZ_PLAN_REQUIRED" },
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
});
test("Free users see the upgrade notice with no creation form, including after a failed plan check", async ({
  page,
}) => {
  let allowedRead = false,
    posts = 0;
  await page.route("**/api/billing", (route) =>
    route.fulfill(
      allowedRead
        ? { json: billing("free") }
        : { status: 503, json: { error: "Temporarily unavailable" } },
    ),
  );
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await page.goto("/?fixture=new-quiz");
  await expect(page.getByText("Quiz eligibility couldn’t load.")).toBeVisible();
  allowedRead = true;
  await page.getByRole("button", { name: "Retry plan check" }).click();
  await expect(
    page.getByRole("region", { name: "Quiz plan requirement" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Compare plans to unlock quizzes" }),
  ).toHaveAttribute("href", "/plans");
  await expect(page.getByLabel("Quiz name", { exact: true })).toHaveCount(0);
  expect(posts).toBe(0);
});
for (const plan of ["plus", "focus", "flex"] as const) {
  test(`${plan} shows the creation form and an authoritative denial locks a stale open form`, async ({
    page,
  }) => {
    let posts = 0;
    await page.route("**/api/billing", (route) =>
      route.fulfill({ json: billing(plan) }),
    );
    await page.route("**/api/quizzes", (route) => {
      posts++;
      return route.fulfill(denied);
    });
    await page.goto("/?fixture=new-quiz");
    await expect(page.getByLabel("Quiz name", { exact: true })).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Fractions", exact: true })
      .check();
    await page
      .getByRole("checkbox", {
        name: "I can share these sources with the tutor to make this quiz.",
      })
      .check();
    await page
      .getByRole("button", { name: "Generate quiz", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Quiz plan requirement" }),
    ).toBeVisible();
    await expect(page.getByLabel("Quiz name", { exact: true })).toHaveCount(0);
    expect(posts).toBe(1);
  });
}
test("a downgraded open quiz preserves the draft, stops requests and can recover after access returns", async ({
  page,
}) => {
  let locked = false,
    reads = 0,
    writes = 0;
  const value = {
    id: quizId,
    title: "Saved fraction practice",
    status: "in_progress",
    revision: 0,
    difficulty: "similar",
    question_count: 1,
    sources: ["Fractions"],
    answers: [null],
    questions: [
      { prompt: "Choose one half.", options: ["1/2", "1/3", "1/4", "1/5"] },
    ],
  };
  await page.route(`**/api/quizzes/${quizId}`, (route) => {
    if (route.request().method() === "PATCH") {
      writes++;
      if (locked) return route.fulfill(denied);
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: { ...value, revision: 1, answers: body.answers },
      });
    }
    reads++;
    return route.fulfill(locked ? denied : { json: value });
  });
  await page.goto("/?fixture=quiz");
  await expect(
    page.getByRole("radio", { name: "1/2", exact: true }),
  ).toBeVisible();
  locked = true;
  await page.getByRole("radio", { name: "1/2", exact: true }).check();
  await expect(
    page.getByRole("region", { name: "Quiz plan requirement" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => JSON.parse(sessionStorage.getItem(`scriblune-quiz-${id}`)!),
      quizId,
    ),
  ).toEqual({ revision: 0, answers: [0] });
  await page.clock.install();
  await page.clock.fastForward(10000);
  expect(reads).toBe(1);
  expect(writes).toBe(1);
  locked = false;
  await page.getByRole("button", { name: "Check access again" }).click();
  await expect(
    page.getByRole("radio", { name: "1/2", exact: true }),
  ).toBeChecked();
  await expect(page.getByText("Answers saved", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
  expect(writes).toBe(2);
});
test("Free Desk retains saved quiz titles and the plan comparison advertises quizzes only on eligible plans", async ({
  page,
}) => {
  await page.route("**/api/billing", (route) =>
    route.fulfill({ json: billing("free") }),
  );
  await page.route("**/api/sessions", (route) =>
    route.fulfill({
      json: {
        sessions: [],
        profile: { display_name: "Student" },
        access: { staff: false },
      },
    }),
  );
  await page.route("**/api/quizzes", (route) =>
    route.fulfill({
      json: {
        quizzes: [
          {
            id: quizId,
            title: "Saved fraction practice",
            status: "completed",
            locked: true,
            question_count: 1,
            difficulty: "similar",
            updated_at: "2026-10-04T00:00:00Z",
          },
        ],
      },
    }),
  );
  await page.goto("/?fixture=desk");
  await expect(
    page.getByRole("heading", { name: "Saved fraction practice" }),
  ).toBeVisible();
  await expect(page.getByText("Unlock quiz", { exact: true })).toHaveText(
    "Unlock quiz",
  );
  await expect(
    page.getByText("Quiz · Saved · Plus and above", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Quizzes · Plus and above", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Quiz plan requirement" }),
  ).toBeVisible();
  await page.route("**/api/auth", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.goto("/?fixture=plans");
  await expect(
    page.getByText("Practice quizzes from sessions & PDFs", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByText("Practice quizzes: Plus and above", { exact: true }),
  ).toBeVisible();
});
