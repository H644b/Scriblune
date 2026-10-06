import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationEnvelope,
  noticePayload,
  sendOwnerNotice,
  NoticeDeliveryError,
  type Notice,
} from "../../src/lib/server/owner-notification-mail";
import {
  ownerNotificationsEnabled,
  processorEnvironment,
  runOwnerNotifications,
} from "../../src/workers/owner-notifications";
const notice: Notice = {
  message_id: "00000000-0000-4000-8000-000000000001",
  thread_id: "00000000-0000-4000-8000-000000000002",
  message_seq: "6",
  recipient: "owner@example.test",
  sender: "Scriblune <notify@example.test>",
  site_origin: "https://scriblune.com",
};
beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-only-key");
  vi.stubEnv("RESEND_FROM_EMAIL", notice.sender);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", notice.site_origin);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("owner notification email transport", () => {
  it("does not pass the email credential into document-processing children", () => {
    expect(
      processorEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "existing-db",
        OPENAI_API_KEY: "existing-ai",
        RESEND_API_KEY: "notice-only",
        RESEND_FROM_EMAIL: "notify@example.test",
        OWNER_REQUEST_EMAILS_ENABLED: "true",
        ACCOUNT_EMAILS_ENABLED: "true",
        AUTH_SECRET: "web-only-recovery-key",
        PROXYCHECK_API_KEY: "web-only-test-key",
        VPN_CHECK_MODE: "enforce",
      }),
    ).toEqual({
      NODE_ENV: "test",
      DATABASE_URL: "existing-db",
      OPENAI_API_KEY: "existing-ai",
    });
  });
  it("contains only a fixed subject, thread link and identifiers, without actions or note content", () => {
    const body = noticePayload(notice);
    expect(body.subject).toBe("Scriblune owner request");
    expect(body.to).toEqual(["owner@example.test"]);
    expect(Object.keys(body)).toEqual(["from", "to", "subject", "text"]);
    expect(body.text).toContain(
      `https://scriblune.com/admin?tab=requests&thread=${notice.thread_id}`,
    );
    expect(body.text).toContain("wake-up signal only");
    expect(body.text).not.toContain("test-only-key");
    expect(body.text).not.toContain("account_id");
  });
  it("uses the fixed Resend endpoint and identical key and payload on an ambiguous retry", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(Response.json({ id: "provider-1" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(sendOwnerNotice(notice)).rejects.toThrow("lost response");
    expect(await sendOwnerNotice(notice)).toBe("provider-1");
    const [first, second] = fetcher.mock.calls;
    expect(first[0]).toBe("https://api.resend.com/emails");
    expect(first[1].headers["Idempotency-Key"]).toBe(
      `owner-request/${notice.message_id}`,
    );
    expect(second[1].body).toBe(first[1].body);
    expect(second[1].headers).toEqual(first[1].headers);
  });
  it.each([
    [429, {}, true],
    [503, {}, true],
    [403, {}, false],
    [409, { name: "invalid_idempotent_request" }, false],
    [409, { name: "concurrent_idempotent_requests" }, true],
  ])(
    "classifies HTTP %s without retaining provider content",
    async (status, body, retryable) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ ...body, secret: "never log this" }, { status }),
          ),
      );
      await expect(sendOwnerNotice(notice)).rejects.toEqual(
        new NoticeDeliveryError(`RESEND_${status}`, retryable),
      );
    },
  );
  it("treats incomplete success as ambiguous and rejects unsafe configuration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    await expect(sendOwnerNotice(notice)).rejects.toMatchObject({
      code: "RESEND_RESPONSE_INTERRUPTED",
      retryable: true,
    });
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://user:secret@scriblune.com");
    expect(() => notificationEnvelope(notice.recipient)).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://scriblune.com");
    vi.stubEnv("RESEND_FROM_EMAIL", "x\nBcc: other@example.test");
    expect(() => notificationEnvelope(notice.recipient)).toThrow();
  });
  it("does no delivery work unless explicitly enabled", async () => {
    vi.stubEnv("OWNER_REQUEST_EMAILS_ENABLED", "false");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(ownerNotificationsEnabled()).toBe(false);
    await runOwnerNotifications(() => false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
