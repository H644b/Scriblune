import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/features/"],
      disallow: [
        "/api/",
        "/study/",
        "/desk",
        "/account/",
        "/feedback/",
        "/admin",
        "/setup",
        "/demo",
      ],
    },
    sitemap: `${brand.url}/sitemap.xml`,
  };
}
