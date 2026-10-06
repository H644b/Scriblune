import { PlanComparison } from "@/components/plan-comparison";
export const metadata = {
  title: "Plans & pricing",
  description:
    "Compare Scriblune Free, Plus, Focus and Flexible plans. Monthly subscriptions with clear daily tutoring allowances. Practice quizzes are included with Plus, Focus and Flexible.",
  alternates: { canonical: "/plans" },
};
export default function Page() {
  return <PlanComparison />;
}
