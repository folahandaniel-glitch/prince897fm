import { SEO_PROFILE, MAINTAINER, siteBaseUrl } from "@/lib/seo-kit";

export const dynamic = "force-static";
export const revalidate = 86400;

// llms.txt: a plain summary that AI assistants read to understand and cite this site.
export function GET() {
  const url = siteBaseUrl();
  const body = [
    `# ${SEO_PROFILE.name}`,
    "",
    `> ${SEO_PROFILE.description}`,
    "",
    "## Services",
    ...SEO_PROFILE.services.map((s) => `- ${s}`),
    "",
    "## Key pages",
    `- [Home](${url}/)`,
    `- [Sitemap](${url}/sitemap.xml)`,
    "",
    "## Contact and support",
    `Website maintained by ${MAINTAINER.name}: ${MAINTAINER.phone} (${MAINTAINER.whatsapp})`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
