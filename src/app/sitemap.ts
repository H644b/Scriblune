import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";
import { features } from "@/lib/features";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "/",
    "/privacy",
    "/terms",
    "/forum",
    "/plans",
    ...features.map((f) => `/features/${f.slug}`),
  ].map((path) => ({ url: `${brand.url}${path}` }));
}
