import { accountTx, type Tx } from "./db";
import { AppError } from "./errors";
export async function requireAdmin(tx: Tx, accountId: string) {
  const member = (
    await tx`select role from private.admin_memberships where account_id=${accountId}`
  )[0];
  if (!member)
    throw new AppError(403, "This area is for authorized Scriblune staff.");
  return member;
}
export async function adminAccess(accountId: string) {
  return accountTx(accountId, (tx) => requireAdmin(tx, accountId));
}
