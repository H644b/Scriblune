import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { adminAccess } from "@/lib/server/admin";
import { AdminPanel } from "@/components/admin-panel";
import Link from "next/link";
export const metadata = {
  title: "Staff feedback review",
  robots: { index: false, follow: false },
};
export default async function Page() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/?signin=1&next=/admin");
  }
  try {
    await adminAccess(user.id);
  } catch {
    return (
      <main className="page-loading">
        <h1>A private staff workspace.</h1>
        <p>Only authorized Scriblune staff can review feedback.</p>
        <Link href="/desk" className="button secondary">
          Return to my desk
        </Link>
      </main>
    );
  }
  return <AdminPanel />;
}
