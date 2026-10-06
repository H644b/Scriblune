import Link from "next/link";
import { LockKeyhole } from "lucide-react";
export function QuizPlanNotice() {
  return (
    <section className="notice" aria-label="Quiz plan requirement">
      <h2>
        <LockKeyhole size={20} aria-hidden="true" /> Practice quizzes · Plus and
        above
      </h2>
      <p>
        Turn your sessions and PDFs into fresh practice questions with Plus,
        Focus or Flexible.
      </p>
      <p>
        Saved quiz titles stay on your desk. Questions, answers and results
        remain stored and unlock when an eligible plan is active again.
      </p>
      <Link className="button primary" href="/plans">
        Compare plans to unlock quizzes
      </Link>
    </section>
  );
}
