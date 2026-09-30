import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { AccountPanel } from "@/components/account-panel";
export const metadata = {
  title: "Your learning preferences",
  robots: { index: false, follow: false },
};
export default async function Page() {
  try {
    await requireUser();
  } catch {
    redirect("/?signin=1&next=/account");
  }
  return <AccountPanel />;
}
