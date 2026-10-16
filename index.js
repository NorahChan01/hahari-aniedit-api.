const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;
const TIMEOUT_MS = 12000;
const MAX_RESULTS = 20;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

function normalizeEscapedText(text) {
  return String(text || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanText(text = "") {
  return normalizeEscapedText(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function platformOf(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();

    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
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

    if (!["https:", "http:"].includes(url.protocol)) return false;

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

    if (!["http:", "https:"].includes(url.protocol)) return null;

    url.hostname = url.hostname.toLowerCase();
    url.search = "";
    url.hash = "";

    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Referer: new URL(url).origin + "/",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    if (
      /verify you are human|unusual traffic|access denied|captcha/i.test(
        text.slice(0, 20000)
      )
    ) {
      throw new Error("Platform blocked or challenged this request");
    }

    return text;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractLinks(page, platform) {
  const text = normalizeEscapedText(page);
  const results = [];
  const seen = new Set();

  // Find complete URLs embedded in HTML and page JSON.
  const urlPattern =
    /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?(?:tiktok\.com|instagram\.com)\/[^\s"'<>\\]+/gi;

  for (const match of text.matchAll(urlPattern)) {
    let rawUrl = match[0].replace(/[),.;]+$/, "");

    try {
      rawUrl = decodeURIComponent(rawUrl);
    } catch {}

    const actualPlatform = platformOf(rawUrl);

    if (!actualPlatform) continue;
    if (platform !== "all" && actualPlatform !== platform) continue;
    if (!isVideoUrl(rawUrl, actualPlatform)) continue;

    const url = normalizeUrl(rawUrl);

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

function makeSearchUrl(platform, query) {
  if (platform === "tiktok") {
    return (
      "https://www.tiktok.com/search/video?q=" +
      encodeURIComponent(query)
    );
  }

  // Instagram's public keyword page; availability varies.
  return (
    "https://www.instagram.com/popular/" +
    encodeURIComponent(query) +
    "/"
  );
}

async function searchPlatform(query, platform) {
  const url = makeSearchUrl(platform, query);
  const page = await fetchPage(url);
  const results = extractLinks(page, platform);

  if (results.length === 0) {
    throw new Error(
      "Page loaded but contained no extractable public video links"
    );
  }

  return results;
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
      error: "Query must be 150 characters or fewer",
    });
  }

  if (!["all", "tiktok", "instagram"].includes(source)) {
    return res.status(400).json({
      success: false,
      error: "source must be tiktok, instagram, or all",
    });
  }

  const platforms =
    source === "all" ? ["tiktok", "instagram"] : [source];

  const settled = await Promise.allSettled(
    platforms.map(async (platform) => ({
      platform,
      results: await searchPlatform(query, platform),
    }))
  );

  const results = [];
  const errors = [];
  const seen = new Set();

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const platform = platforms[i];

    if (result.status === "rejected") {
      errors.push({
        platform,
        error: String(
          result.reason?.message || "Search failed"
        ),
      });
      continue;
    }

    for (const item of result.value.results) {
      if (seen.has(item.url)) continue;

      seen.add(item.url);
      results.push(item);
    }
  }

  res.json({
    success: results.length > 0,
    query,
    source,
    count: results.length,
    results: results.slice(0, MAX_RESULTS),
    errors,
    note:
      results.length > 0
        ? "Search completed"
        : "No video links extracted. Check the platform errors; direct search may be blocked or unavailable.",
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Anime Edit Search API listening on ${PORT}`);
});
