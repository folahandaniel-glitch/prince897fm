import type { MetadataRoute } from "next";
import { AI_CRAWLERS, siteBaseUrl } from "@/lib/seo-kit";

const PRIVATE = ["/api", "/backend", "/account", "/f", "/forbidden", "/forgot", "/login", "/register", "/reset", "/setup", "/wallboard", "/dashboard"];

export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
