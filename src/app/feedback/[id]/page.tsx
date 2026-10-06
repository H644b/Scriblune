import { signInDestination } from "@/lib/network-policy";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { accountTx, ownedSession } from "@/lib/server/db";
import { FeedbackPage } from "@/components/feedback-page";
import { z } from "zod";
export const metadata = {
  title: "A moment to reflect",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = z.uuid().parse((await params).id);
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    redirect(
      signInDestination(
        error,
        `/?signin=1&next=${encodeURIComponent(`/feedback/${id}`)}`,
      ),
    );
  }
  const s = await accountTx(user.id, (tx) => ownedSession(tx, id));
  if (s.status !== "submitted") redirect(`/study/${id}`);
  return <FeedbackPage id={id} />;
}
