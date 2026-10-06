import { signInDestination } from "@/lib/network-policy";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { PaymentPage } from "@/components/payment-page";
import { flexCredits, planKey } from "@/lib/plans";
export const metadata = {
  title: "Upgrade your study desk",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireUser();
  } catch (error) {
    redirect(signInDestination(error, "/?signin=1&next=/plans"));
  }
  const params = await searchParams;
  const plan = planKey.safeParse(params.plan),
    credits = flexCredits.safeParse(Number(params.credits || 30));
  if (!plan.success || plan.data === "free" || !credits.success)
    redirect("/plans");
  return <PaymentPage plan={plan.data} credits={credits.data} />;
}
