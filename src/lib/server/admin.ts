import { accountTx, type Tx } from "./db";
import { AppError } from "./errors";
import { PERMISSIONS, type Permission, type StaffAccess } from "../community";
export async function staffAccess(
  tx: Tx,
  accountId: string,
): Promise<StaffAccess> {
  const owner =
    (
      await tx`select account_id from private.site_owners where account_id=${accountId}`
    ).length > 0;
  const rows =
    await tx`select r.key,r.permissions from private.staff_assignments a join private.staff_roles r on r.key=a.role_key where a.account_id=${accountId}`;
  return {
    owner,
    staff: owner || rows.length > 0,
    roles: rows.map((r) => r.key),
    permissions: owner
      ? (Object.keys(PERMISSIONS) as Permission[])
      : [...new Set(rows.flatMap((r) => r.permissions as Permission[]))],
  };
}
export async function requirePermission(
  tx: Tx,
  accountId: string,
  permission: Permission | "staff.manage",
) {
  const access = await staffAccess(tx, accountId);
  if (
    permission === "staff.manage"
      ? !access.owner
      : !access.permissions.includes(permission)
  )
    throw new AppError(
      403,
      "Your account does not have permission to do this.",
    );
  return access;
}
export async function requireAdmin(tx: Tx, accountId: string) {
  return requirePermission(tx, accountId, "feedback.read");
}
export async function adminAccess(accountId: string) {
  return accountTx(accountId, async (tx) => {
    const access = await staffAccess(tx, accountId);
    if (!access.staff)
      throw new AppError(403, "This area is for authorized Scriblune staff.");
    return access;
  });
}
