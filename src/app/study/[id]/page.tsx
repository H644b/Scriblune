import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { WorkspaceLoader } from "@/components/workspace-room";
import { z } from "zod";
export const metadata = {
  title: "Your study workspace",
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
  } catch {
    redirect(`/?signin=1&next=${encodeURIComponent(`/study/${id}`)}`);
  }
  return <WorkspaceLoader sessionId={id} />;
}
