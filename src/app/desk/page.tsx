import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { Desk } from "@/components/desk";
export const metadata = {
  title: "Your study desk",
  robots: { index: false, follow: false },
};
export default async function Page() {
  try {
    await requireUser();
  } catch {
    redirect("/?signin=1&next=/desk");
  }
  return <Desk />;
}
