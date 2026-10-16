const express = require("express");
const youtubedl = require("youtube-dl-exec");

const app = express();
const PORT = process.env.PORT || 10000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const SEARCH_TIMEOUT = 8000;
const MAX_RESULTS = 20;

const SEARCH_ENGINES = [
  {
    name: "google",
    url: (q) =>
      "https://www.google.com/search?q=" +
      encodeURIComponent(q) +
      "&num=20",
  },
  {
    name: "bing",
    url: (q) =>
      "https://www.bing.com/search?q=" +
      encodeURIComponent(q) +
      "&count=20",
  },
];

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
  return decodeHtml(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapUrl(rawUrl = "") {
  try {
    let url = decodeHtml(rawUrl);

    if (url.startsWith("//")) {
      url = "https:" + url;
    }

    const parsed = new URL(url, "https://www.google.com");

    if (parsed.pathname === "/url") {
      url =
        parsed.searchParams.get("q") ||
        parsed.searchParams.get("url") ||
        url;
    } else if (parsed.hostname.includes("bing.com")) {
      url = parsed.searchParams.get("u") || url;

      if (url.startsWith("a1")) {
        try {
          url = Buffer.from(url.slice(2), "base64").toString();
        } catch {}
      }
    }

    if (url.startsWith("//")) {
      url = "https:" + url;
    }

    const result = new URL(url);

    if (!["http:", "https:"].includes(result.protocol)) {
      return null;
    }

    return result.href;
  } catch {
    return null;
  }
}

function identifyPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();

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

    return null;
  } catch {
    return null;
  }
}

function isValidVideoPage(url, platform) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (platform === "tiktok") {
      return (
        (host === "tiktok.com" ||
          host.endsWith(".tiktok.com")) &&
        /\/@[^/]+\/video\/\d+/i.test(parsed.pathname)
      );
    }

    if (platform === "instagram") {
      return (
        (host === "instagram.com" ||
          host.endsWith(".instagram.com")) &&
        /^\/(reel|reels|p)\/[^/]+/i.test(parsed.pathname)
      );
    }

    return false;
  } catch {
    return false;
  }
}

function parseSearchResults(html, platform) {
  const results = [];
  const seen = new Set();

  const anchors =
    html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];

  for (const anchor of anchors) {
    const hrefMatch = anchor.match(
      /\bhref\s*=\s*["']([^"']+)["']/i
    );

    if (!hrefMatch) continue;

    const url = unwrapUrl(hrefMatch[1]);

    if (!url || !isValidVideoPage(url, platform)) continue;

    const normalized = url.split("?")[0].replace(/\/$/, "");

    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const titleMatch = anchor.match(
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i
    );

    let title = titleMatch
      ? cleanText(titleMatch[1])
      : cleanText(anchor);

    if (!title || title.length < 3) {
      title =
        platform === "tiktok"
          ? "TikTok anime edit"
          : "Instagram anime edit";
    }

    results.push({
      title: title.slice(0, 250),
      url: normalized,
      platform,
    });

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    SEARCH_TIMEOUT
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    if (
      /unusual traffic|captcha|verify you are human|access denied/i.test(
        html.slice(0, 15000)
      )
    ) {
      throw new Error("Search engine blocked this request");
    }

    return html;
  } finally {
    clearTimeout(timer);
  }
}

async function searchEngine(engine, query, platform) {
  const site =
    platform === "all"
      ? "(site:tiktok.com OR site:instagram.com)"
      : `site:${platform}.com`;

  const searchQuery =
    `${site} "${query}" anime edit`;

  const html = await fetchWithTimeout(
    engine.url(searchQuery)
  );

  if (platform === "all") {
    return [
      ...parseSearchResults(html, "tiktok"),
      ...parseSearchResults(html, "instagram"),
    ];
  }

  return parseSearchResults(html, platform);
}

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Anime Edit API",
    status: "online",
    paidApiKeysRequired: false,
    endpoints: {
      search: "/api/search?q=gojo&source=all",
      download:
        "/api/download?url=ENCODED_PUBLIC_TIKTOK_OR_INSTAGRAM_URL",
    },
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const source = String(req.query.source || "all").toLowerCase();

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Missing search query. Use ?q=gojo",
    });
  }

  if (!["all", "tiktok", "instagram"].includes(source)) {
    return res.status(400).json({
      success: false,
      error: "Source must be all, tiktok, or instagram",
    });
  }

  if (query.length > 150) {
    return res.status(400).json({
      success: false,
      error: "Search query is too long",
    });
  }

  const platforms =
    source === "all" ? ["tiktok", "instagram"] : [source];

  const tasks = SEARCH_ENGINES.map(async (engine) => {
    const output = [];

    for (const platform of platforms) {
      try {
        const results = await searchEngine(
          engine,
          query,
          platform
        );

        output.push(...results);
      } catch (error) {
        console.error(
          `Search ${engine.name}/${platform}:`,
          error.message
        );
      }
    }

    return output;
  });

  const batches = await Promise.allSettled(tasks);
  const combined = [];
  const seen = new Set();

  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;

    for (const item of batch.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      combined.push(item);
    }
  }

  res.json({
    success: combined.length > 0,
    query,
    source,
    count: combined.length,
    results: combined.slice(0, MAX_RESULTS),
    note:
      combined.length > 0
        ? "Search completed"
        : "No results found. Google and Bing may block requests from this server or have no indexed matches.",
  });
});

app.get("/api/download", async (req, res) => {
  const url = String(req.query.url || "").trim();
  const platform = identifyPlatform(url);

  if (!url || !platform) {
    return res.status(400).json({
      success: false,
      error:
        "Provide a public TikTok or Instagram video URL.",
    });
  }

  if (!isValidVideoPage(url, platform)) {
    return res.status(400).json({
      success: false,
      platform,
      error: "The URL is not a supported video page.",
    });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noPlaylist: true,
      format: "best[ext=mp4]/best",
      socketTimeout: 20,
      retries: 1,
    });

    const downloadUrl = info.url;

    if (!downloadUrl) {
      throw new Error("No direct video URL returned");
    }

    res.json({
      success: true,
      platform,
      title: info.title || "Anime edit",
      downloadUrl,
      url: downloadUrl,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
    });
  } catch (error) {
    console.error("Download failed:", error.message);

    res.status(502).json({
      success: false,
      platform,
      error:
        "Download failed. The platform may block the server, or the video may be private or unavailable.",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Anime Edit API listening on port ${PORT}`);
});
