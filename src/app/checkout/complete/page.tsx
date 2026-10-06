import { signInDestination } from "@/lib/network-policy";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { PaymentComplete } from "@/components/payment-page";
export const metadata = {
  title: "Your plan update",
  robots: { index: false, follow: false },
};
export default async function Page() {
  try {
    await requireUser();
  } catch (error) {
    redirect(signInDestination(error, "/?signin=1&next=/plans"));
  }
  return <PaymentComplete />;
}
