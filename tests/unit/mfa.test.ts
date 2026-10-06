import { expect, it } from "vitest";
import { TOTP } from "otpauth";
import {
  validTotpStep,
  backupDigest,
  relyingParty,
} from "../../src/lib/server/mfa";
it("accepts only current neighboring TOTP windows and prevents replay", () => {
  const secret = "JBSWY3DPEHPK3PXP",
    now = 1_800_000_000_000;
  const app = new TOTP({ secret, algorithm: "SHA1", digits: 6, period: 30 });
  const code = app.generate({ timestamp: now });
  expect(validTotpStep(secret, code, -1, now)).toBe(now / 30000);
  expect(validTotpStep(secret, code, now / 30000, now)).toBeNull();
  expect(
    validTotpStep(secret, app.generate({ timestamp: now - 60_000 }), -1, now),
  ).toBeNull();
  expect(validTotpStep(secret, "bad", -1, now)).toBeNull();
});
it("binds backup codes to their account and accepts ordinary copy formatting", () => {
  process.env.AUTH_SECRET = "ab".repeat(32);
  expect(backupDigest("a", "ABCDE-12345-ABCDE-12345")).toBe(
    backupDigest("a", "abcde12345 abcde12345"),
  );
  expect(backupDigest("a", "ABCDE")).not.toBe(backupDigest("b", "ABCDE"));
});
it("binds WebAuthn to the configured origin and requires TLS away from loopback", () => {
  const old = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://scriblune.com/";
    expect(relyingParty()).toEqual({
      rpID: "scriblune.com",
      origin: "https://scriblune.com",
    });
    process.env.NEXT_PUBLIC_SITE_URL = "http://example.org";
    expect(() => relyingParty()).toThrow("secure connection");
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = old;
  }
});
