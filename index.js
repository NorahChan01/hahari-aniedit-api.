const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const SOURCES = {
  tiktok: "site:tiktok.com",
  instagram: "site:instagram.com/reel"
};

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Anime Edit API",
    status: "online",
    sources: ["tiktok", "instagram"]
  });
});

async function searchSource(platform, query) {
  const searchQuery = `${SOURCES[platform]} ${query} anime edit`;
  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(searchQuery);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = [];
  const seen = new Set();

  const regex =
    /class=["']result__a["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) && results.length < 10) {
    let link = match[1];

    try {
      const parsed = new URL(link, url);
      link =
        parsed.searchParams.get("uddg") ||
        parsed.searchParams.get("url") ||
        link;
    } catch {}

    try {
      link = decodeURIComponent(link);
    } catch {}

    let parsed;

    try {
      parsed = new URL(link);
    } catch {
      continue;
    }

    const host = parsed.hostname.toLowerCase();

    const isTikTok =
      host === "tiktok.com" || host.endsWith(".tiktok.com");

    const isInstagram =
      host === "instagram.com" || host.endsWith(".instagram.com");

    if (platform === "tiktok" && !isTikTok) continue;

    if (
      platform === "instagram" &&
      (!isInstagram || !/^\/(reel|reels|p)\//i.test(parsed.pathname))
    ) continue;

    if (!["http:", "https:"].includes(parsed.protocol)) continue;

    parsed.search = "";
    parsed.hash = "";
    const cleanUrl = parsed.href.replace(/\/$/, "");

    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    results.push({
      platform,
      title: match[2]
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim(),
      url: cleanUrl
    });
  }

  // If the HTML layout changes, try DuckDuckGo's redirect-link format.
  if (results.length === 0) {
    const fallbackRegex =
      /href=["']([^"']*(?:tiktok\.com|instagram\.com)[^"']*)["']/gi;

    while ((match = fallbackRegex.exec(html)) && results.length < 10) {
      let link = match[1].replace(/&amp;/g, "&");

      try {
        const parsed = new URL(link, url);
        link = parsed.searchParams.get("uddg") || link;
      } catch {}

      try {
        link = decodeURIComponent(link);
      } catch {}

      let parsed;

      try {
        parsed = new URL(link);
      } catch {
        continue;
      }

      const host = parsed.hostname.toLowerCase();
      const isTikTok =
        host === "tiktok.com" || host.endsWith(".tiktok.com");
      const isInstagram =
        host === "instagram.com" || host.endsWith(".instagram.com");

      if (platform === "tiktok" && !isTikTok) continue;
      if (platform === "instagram" && !isInstagram) continue;
      if (!["http:", "https:"].includes(parsed.protocol)) continue;

      if (
        platform === "instagram" &&
        !/^\/(reel|reels|p)\//i.test(parsed.pathname)
      ) continue;

      parsed.search = "";
      parsed.hash = "";
      const cleanUrl = parsed.href.replace(/\/$/, "");

      if (seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);

      results.push({
        platform,
        title: "Anime edit",
        url: cleanUrl
      });
    }
  }

  return { platform, results };
}

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const source = String(req.query.source || "all").toLowerCase();

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Provide a search query using ?q=gojo"
    });
  }

  if (!["all", "tiktok", "instagram"].includes(source)) {
    return res.status(400).json({
      success: false,
      error: "Source must be all, tiktok, or instagram"
    });
  }

  const platforms =
    source === "all" ? ["tiktok", "instagram"] : [source];

  const settled = await Promise.allSettled(
    platforms.map(platform => searchSource(platform, query))
  );

  const results = [];
  const errors = [];

  settled.forEach((item, index) => {
    if (item.status === "fulfilled") {
      results.push(...item.value.results);
    } else {
      errors.push({
        platform: platforms[index],
        error: item.reason?.message || "Search failed"
      });
    }
  });

  res.json({
    success: errors.length === 0 && results.length > 0,
    query,
    source,
    count: results.length,
    results,
    ...(errors.length ? { errors } : {})
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Anime Edit API listening on ${PORT}`);
});
