import { AppError } from "./errors";

export function requireEmail() {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
    throw new AppError(
      503,
      "Verification email is not configured. Please contact support.",
      "EMAIL_NOT_CONFIGURED",
    );
}
export async function sendCode(
  email: string,
  code: string,
  purpose: string,
  id: string,
) {
  requireEmail();
  const action =
    purpose === "signup"
      ? "finish creating your account"
      : purpose === "staff_action"
        ? "confirm the exact staff action you just reviewed"
        : purpose === "recovery"
          ? "reset your password"
          : purpose === "enable"
            ? "turn on email two-step verification"
            : purpose === "disable"
              ? "turn off email two-step verification"
              : "finish signing in";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `auth/${id}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email],
      subject: "Your Scriblune verification code",
      text: `Your Scriblune verification code is ${code}.\n\nEnter it to ${action}. It expires in 10 minutes and can be used once. Never share this code.\n\nIf you did not request this, you can ignore this email.`,
      html: `<div style="background:#f7f3eb;padding:36px;font-family:Arial,sans-serif;color:#20283a;max-width:520px"><h1 style="font-family:Georgia,serif">Scriblune</h1><p>Enter this code to ${action}.</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold">${code}</p><p>Expires in 10 minutes. Use it once, and never share it.</p><p>If you did not request this, you can ignore this email.</p></div>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new AppError(
      503,
      "We couldn’t send your code. Please try again shortly or contact support.",
      "EMAIL_UNAVAILABLE",
    );
}
