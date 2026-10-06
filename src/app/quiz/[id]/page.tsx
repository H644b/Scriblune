import { signInDestination } from "@/lib/network-policy";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { QuizRoom } from "@/components/quiz-room";
export const metadata = {
  title: "Your practice quiz",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) redirect("/desk");
  try {
    await requireUser();
  } catch (error) {
    redirect(
      signInDestination(
        error,
        `/?signin=1&next=${encodeURIComponent(`/quiz/${id}`)}`,
      ),
    );
  }
  return <QuizRoom id={id} />;
}
