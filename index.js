const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const TIMEOUT_MS = 7000;
const MAX_RESULTS = 20;

// Public, key-free search sources. Availability can change.
const SEARCH_SOURCES = [
  {
    name: "searx",
    url: "https://searx.tiekoetter.com/search",
    format: "json",
  },
  {
    name: "searx",
    url: "https://search.sapti.me/search",
    format: "json",
  },
  {
    name: "google",
    url: "https://www.google.com/search",
    format: "html",
  },
  {
    name: "bing",
    url: "https://www.bing.com/search",
    format: "html",
  },
];

function platformOf(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();

    if (
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com")
    ) {
      return "tiktok";
    }

    if (
      host === "instagram.com" ||
      host.endsWith(".instagram.com")
    ) {
      return "instagram";
    }
  } catch {}

  return null;
}

function isVideoUrl(rawUrl, platform) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return false;
    }

    if (platform === "tiktok") {
      return (
        (host === "tiktok.com" || host.endsWith(".tiktok.com")) &&
        /\/@[^/]+\/video\/\d+/i.test(url.pathname)
      );
    }

    if (platform === "instagram") {
      return (
        (host === "instagram.com" ||
          host.endsWith(".instagram.com")) &&
        /^\/(reel|reels|p)\/[^/]+/i.test(url.pathname)
      );
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    url.search = "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    );
}

function cleanText(value = "") {
  return decodeHtml(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "application/json,text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractHtmlLinks(html, platform) {
  const results = [];
  const seen = new Set();

  // Extract URLs from href attributes, even when result markup changes.
  const matches =
    html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi);

  for (const match of matches) {
    let raw = decodeHtml(match[1]);

    try {
      if (raw.startsWith("//")) raw = "https:" + raw;

      const base = new URL(raw, "https://www.google.com");

      if (
        base.hostname.includes("google.com") &&
        base.pathname === "/url"
      ) {
        raw =
          base.searchParams.get("q") ||
          base.searchParams.get("url") ||
          raw;
      } else if (
        base.hostname.includes("bing.com") &&
        base.pathname === "/ck/a"
      ) {
        const encoded = base.searchParams.get("u");

        if (encoded?.startsWith("a1")) {
          raw = Buffer.from(encoded.slice(2), "base64").toString();
        }
      }
    } catch {
      continue;
    }

    const actualPlatform = platformOf(raw);

    if (!actualPlatform) continue;
    if (platform !== "all" && actualPlatform !== platform) continue;
    if (!isVideoUrl(raw, actualPlatform)) continue;

    const url = normalizeUrl(raw);

    if (!url || seen.has(url)) continue;
    seen.add(url);

    results.push({
      title:
        actualPlatform === "tiktok"
          ? "TikTok video"
          : "Instagram reel",
      url,
      platform: actualPlatform,
    });

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

function extractJsonResults(data, platform) {
  const items = Array.isArray(data.results) ? data.results : [];
  const results = [];

  for (const item of items) {
    const rawUrl = item.url || item.link;

    if (!rawUrl) continue;

    const actualPlatform = platformOf(rawUrl);

    if (!actualPlatform) continue;
    if (platform !== "all" && actualPlatform !== platform) continue;
    if (!isVideoUrl(rawUrl, actualPlatform)) continue;

    results.push({
      title: cleanText(item.title || "Anime edit").slice(0, 250),
      url: normalizeUrl(rawUrl),
      platform: actualPlatform,
      description: cleanText(item.content || item.description || "")
        .slice(0, 500),
    });
  }

  return results.filter((item) => item.url);
}

async function searchSource(source, query, platform) {
  const siteQuery =
    platform === "all"
      ? `(site:tiktok.com OR site:instagram.com) "${query}" anime edit`
      : `site:${platform}.com "${query}" anime edit`;

  const url = new URL(source.url);
  url.searchParams.set("q", siteQuery);

  if (source.format === "json") {
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en");
    url.searchParams.set("safesearch", "0");
  }

  const body = await fetchText(url.href);

  if (source.format === "json") {
    let data;

    try {
      data = JSON.parse(body);
    } catch {
      throw new Error("Search source returned invalid JSON");
    }

    return extractJsonResults(data, platform);
  }

  return extractHtmlLinks(body, platform);
}

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Anime Edit Search API",
    status: "online",
    paidApiKeysRequired: false,
    endpoints: {
      search: "/api/search?q=gojo&source=tiktok",
      supportedSources: ["tiktok", "instagram", "all"],
    },
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const source = String(req.query.source || "all").toLowerCase();

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Missing query. Example: /api/search?q=gojo",
    });
  }

  if (query.length > 150) {
    return res.status(400).json({
      success: false,
      error: "Query must be 150 characters or fewer.",
    });
  }

  if (!["all", "tiktok", "instagram"].includes(source)) {
    return res.status(400).json({
      success: false,
      error: "source must be tiktok, instagram, or all.",
    });
  }

  const results = [];
  const seen = new Set();
  const errors = [];

  // Query every source concurrently to avoid sequential delays.
  const attempts = await Promise.allSettled(
    SEARCH_SOURCES.map(async (searchSource) => ({
      engine: searchSource.name,
      items: await searchSource(searchSource, query, source),
    }))
  );

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const engine = SEARCH_SOURCES[i].name;

    if (attempt.status === "rejected") {
      errors.push({
        engine,
        error:
          attempt.reason?.name === "AbortError"
            ? "Request timed out"
            : String(attempt.reason?.message || "Search failed"),
      });
      continue;
    }

    for (const item of attempt.value.items) {
      if (!item.url || seen.has(item.url)) continue;

      seen.add(item.url);
      results.push(item);
    }
  }

  res.json({
    success: results.length > 0,
    query,
    source,
    count: Math.min(results.length, MAX_RESULTS),
    results: results.slice(0, MAX_RESULTS),
    errors,
    note:
      results.length > 0
        ? "Search completed."
        : "No matching public video links found. Check errors; public search services may be blocked or unavailable.",
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Anime Edit Search API running on port ${PORT}`);
});
