import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  visibleBadge,
  NO_ACCESS,
  usernameSchema,
  forumAction,
} from "../../src/lib/community";
import {
  ForumMarkdown,
  StaffBadge,
} from "../../src/components/community-shared";
import { prepareCommunityMedia } from "../../src/lib/server/community-media";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

describe("community identity, markup and uploads", () => {
  it("uses opt-in owner / moderator / staff precedence and the requested icons", () => {
    const a = { owner: false, staff: true, roles: ["tester"], permissions: [] };
    expect(visibleBadge(a, false)).toBe(null);
    expect(visibleBadge(a, true)).toBe("staff");
    expect(visibleBadge({ ...a, roles: ["tester", "moderator"] }, true)).toBe(
      "mod",
    );
    expect(
      visibleBadge({ ...a, owner: true, roles: ["moderator"] }, true),
    ).toBe("owner");
    expect(visibleBadge(NO_ACCESS, true)).toBe(null);
    expect(
      renderToStaticMarkup(createElement(StaffBadge, { badge: "owner" })),
    ).toContain("lucide-key-round");
    expect(
      renderToStaticMarkup(createElement(StaffBadge, { badge: "staff" })),
    ).toContain("lucide-hard-hat");
    expect(
      renderToStaticMarkup(createElement(StaffBadge, { badge: "mod" })),
    ).toContain("lucide-hammer");
  });
  it("renders Markdown without scripts, event handlers, remote images or unsafe links", () => {
    const html = renderToStaticMarkup(
      createElement(ForumMarkdown, {
        body: "**Hello** <script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n\n![tracker](https://evil.invalid/track)\n\n[docs](https://example.com)",
      }),
    );
    expect(html).toContain("<strong>Hello</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('src="https://evil.invalid');
    expect(html).toContain("noopener noreferrer nofollow ugc");
  });
  it("normalizes usernames and rejects forged client identity fields", () => {
    expect(usernameSchema.parse(" A_Name ")).toBe("a_name");
    expect(usernameSchema.safeParse("<img>").success).toBe(false);
    expect(
      forumAction.safeParse({
        action: "thread",
        category_id: crypto.randomUUID(),
        title: "A valid title",
        body: "Text",
        author_id: crypto.randomUUID(),
        badge: "owner",
      }).success,
    ).toBe(false);
  });
  it("re-encodes images, validates PDFs, and rejects HTML/SVG disguised as media", async () => {
    const image = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const avatar = await prepareCommunityMedia(image, true);
    expect(avatar.mime).toBe("image/webp");
    const meta = await sharp(avatar.bytes).metadata();
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
    expect(meta.exif).toBeUndefined();
    await expect(
      prepareCommunityMedia(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
        false,
      ),
    ).rejects.toThrow();
    await expect(
      prepareCommunityMedia(Buffer.from("%PDF-corrupt"), false),
    ).rejects.toThrow();
    await expect(
      prepareCommunityMedia(new Uint8Array(10 * 1024 * 1024 + 1), false),
    ).rejects.toThrow();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    expect((await prepareCommunityMedia(await pdf.save(), false)).mime).toBe(
      "application/pdf",
    );
    await expect(
      prepareCommunityMedia(await pdf.save(), true),
    ).rejects.toThrow();
  });
});
