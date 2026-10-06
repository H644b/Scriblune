export type FactorMethod = "email" | "totp" | "passkey" | "backup";
export const factorLabels: Record<FactorMethod, string> = {
  email: "Email code",
  totp: "Authenticator app",
  passkey: "Passkey",
  backup: "Backup code",
};
export type SecuritySettings = {
  enabled: boolean;
  email: string;
  totp: boolean;
  passkeys: {
    id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
  }[];
  backupCodes: number;
};
