import { z } from "zod";
import { requireEmail } from "./email";

export const noticeSubject = "Scriblune owner request";
const mailbox = z.email().max(320);
export function notificationAddress(email: string) {
  return mailbox.parse(email.trim()).toLowerCase();
}
export function notificationEnvelope(email: string) {
  const recipient = notificationAddress(email);
  const sender = z
    .string()
    .min(3)
    .max(320)
    .refine((s) => !/[\r\n]/.test(s))
    .parse(process.env.RESEND_FROM_EMAIL);
  const origin = new URL(
    z.string().url().parse(process.env.NEXT_PUBLIC_SITE_URL),
  );
  if (
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid notification origin.");
  return { recipient, sender, site_origin: origin.origin };
}
export type Notice = {
  message_id: string;
  thread_id: string;
  message_seq: string;
  recipient: string;
  sender: string;
  site_origin: string;
};
export function noticePayload(notice: Notice) {
  const message = z.uuid().parse(notice.message_id),
    thread = z.uuid().parse(notice.thread_id),
    seq = z
      .string()
      .regex(/^[0-9]{1,18}$/)
      .parse(String(notice.message_seq));
  const link = new URL("/admin", notice.site_origin);
  link.searchParams.set("tab", "requests");
  link.searchParams.set("thread", thread);
  return {
    from: notice.sender,
    to: [notificationAddress(notice.recipient)],
    subject: noticeSubject,
    text: `A new owner note or reply is available in Scriblune.\n\n${link.href}\n\nThread ID: ${thread}\nMessage ID: ${message}\nMessage sequence: ${seq}\n\nThis notification is a wake-up signal only. Read the authenticated owner inbox to verify the message and any requested action.`,
  };
}
export class NoticeDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
export async function sendOwnerNotice(notice: Notice) {
  requireEmail();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `owner-request/${notice.message_id}`,
    },
    body: JSON.stringify(noticePayload(notice)),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const retryable =
      response.status >= 500 ||
      [408, 429].includes(response.status) ||
      (response.status === 409 &&
        result?.name === "concurrent_idempotent_requests");
    throw new NoticeDeliveryError(`RESEND_${response.status}`, retryable);
  }
  if (typeof result?.id !== "string" || !result.id || result.id.length > 200)
    throw new NoticeDeliveryError("RESEND_RESPONSE_INTERRUPTED", true);
  return result.id as string;
}
