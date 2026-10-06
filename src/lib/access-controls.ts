import { z } from "zod";
export const signupModes = ["open", "closed", "waitlist"] as const;
export type SignupMode = (typeof signupModes)[number];
export const accountActions = {
  password_recovery: "Send password recovery link",
  revoke_sessions: "Sign out all devices",
  reset_totp: "Reset authenticator app",
  reset_passkeys: "Reset passkeys",
  reset_factors: "Reset authenticator and passkeys",
  request_deletion: "Suspend and request permanent deletion",
} as const;
const common = { id: z.uuid(), reason: z.string().trim().min(8).max(500) };
const target = {
  target_id: z.uuid(),
  confirm_email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
};
export const accessIntent = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      ...target,
      kind: z.enum(["free_confirm", "free_dismiss", "free_separate"]),
      pair_id: z.uuid(),
      revision: z.number().int().nonnegative(),
      member_ids: z.array(z.uuid()).min(2).max(8),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("signup_mode"),
      mode: z.enum(signupModes),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...common,
      ...target,
      kind: z.enum(["waitlist_approve", "waitlist_reject"]),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...common,
      ...target,
      kind: z.enum(
        Object.keys(accountActions) as [
          keyof typeof accountActions,
          ...(keyof typeof accountActions)[],
        ],
      ),
    })
    .strict(),
]);
export type AccessIntent = z.infer<typeof accessIntent>;
export const accessCommand = z.discriminatedUnion("stage", [
  z
    .object({
      stage: z.literal("owner_confirm"),
      intent: accessIntent,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      stage: z.literal("prepare"),
      intent: accessIntent,
      password: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      stage: z.literal("execute"),
      intent: accessIntent,
      code: z.string().min(6).max(64).optional(),
      response: z
        .custom<import("@simplewebauthn/browser").AuthenticationResponseJSON>(
          (v) =>
            !!v &&
            typeof v === "object" &&
            typeof (v as { id?: unknown }).id === "string",
        )
        .optional(),
    })
    .strict(),
  z
    .object({
      stage: z.literal("method"),
      intent: accessIntent,
      method: z.enum(["totp", "passkey", "email", "backup"]),
    })
    .strict(),
  z.object({ stage: z.literal("cancel"), intent: accessIntent }).strict(),
]);
export function ownerAction(intent: AccessIntent) {
  return intent.kind === "signup_mode" || intent.kind.startsWith("waitlist_");
}
export type WaitlistEntry = {
  id: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  revision: number;
  created_at: string;
  decided_at: string | null;
  mail_status: string | null;
};
export type ManagedAccount = {
  free_allowance?: {
    candidates: number;
    shared: boolean;
    provisional?: boolean;
    appeal: boolean;
  };
  id: string;
  email: string;
  email_verified: boolean;
  created_at: string;
  is_owner: boolean;
  is_admin: boolean;
  on_hold: boolean;
  totp: boolean;
  email_two_step: boolean;
  passkeys: number;
  backup_codes: number;
};
export const actionDescriptions: Record<keyof typeof accountActions, string> = {
  password_recovery:
    "Email a one-use recovery link that expires in 30 minutes. Existing second-factor requirements still apply. You will never see or choose this person's password.",
  revoke_sessions:
    "Revoke all current sign-ins, verification challenges, and recovery links. Saved work and enrolled security methods remain intact.",
  reset_totp:
    "Remove the authenticator app, invalidate backup codes and all existing sessions, and enable verified-email two-step recovery. Passkeys remain enrolled.",
  reset_passkeys:
    "Remove all passkeys, invalidate backup codes and all existing sessions, and enable verified-email two-step recovery. The authenticator remains enrolled.",
  reset_factors:
    "Remove the authenticator and all passkeys, invalidate backup codes and sessions, and enable verified-email two-step recovery. Saved work remains intact.",
  request_deletion:
    "Suspend sign-in and queue one verified permanent-deletion request. An operator must complete billing, storage, and account removal during maintenance. Data remains until that process finishes. Billing is not cancelled by this action.",
};
