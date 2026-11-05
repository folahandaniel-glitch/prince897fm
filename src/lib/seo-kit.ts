// SEO and AI discoverability profile. Shared by robots, sitemap, llms.txt and JSON-LD.
export function siteBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "https://prince897fm.vercel.app";
  return raw.replace(/\/+$/, "");
}

export const SEO_PROFILE = {
  "name": "Prince 89.7 FM WorkSuite",
  "type": "Organization",
  "description": "Prince 89.7 FM WorkSuite: the station's internal staff platform for rosters, HR, documents, training and reporting.",
  "services": [
    "Staff rosters",
    "HR and leave",
    "Documents and training",
    "Reporting"
  ]
} as const;

export const MAINTAINER = { name: "Fodan Softnet", phone: "+2348067578112", whatsapp: "https://wa.me/2348067578112" } as const;

// Crawlers that power Google, Bing and AI assistants (ChatGPT, Claude, Perplexity, Gemini, Copilot).
export const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot", "Meta-ExternalAgent", "Amazonbot", "DuckAssistBot", "cohere-ai", "YouBot"];

export function organizationJsonLd() {
  const url = siteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": SEO_PROFILE.type,
    name: SEO_PROFILE.name,
    description: SEO_PROFILE.description,
    url,
    logo: `${url}/icon.png`,
    makesOffer: SEO_PROFILE.services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s } })),
  };
}
