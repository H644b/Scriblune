import { notFound } from "next/navigation";
import { z } from "zod";
import { ForumDiscussion } from "@/components/forum";
export const metadata = { title: "Community discussion · Scriblune" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <ForumDiscussion id={id} />;
}
