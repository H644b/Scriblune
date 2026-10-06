import { signInDestination } from "@/lib/network-policy";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { adminAccess } from "@/lib/server/admin";
import { StaffWorkspace } from "@/components/staff-workspace";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
export const metadata = {
  title: "Staff feedback review",
  robots: { index: false, follow: false },
};
export default async function Page() {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    redirect(signInDestination(error, "/?signin=1&next=/admin"));
  }
  let access;
  try {
    access = await adminAccess(user.id);
  } catch {
    return (
      <main className="page-loading">
        <div className="password-theme">
          <ThemeToggle />
        </div>
        <h1>A private staff workspace.</h1>
        <p>Only authorized Scriblune staff can review feedback.</p>
        <Link href="/desk" className="button secondary">
          Return to my desk
        </Link>
      </main>
    );
  }
  return <StaffWorkspace access={access} />;
}
