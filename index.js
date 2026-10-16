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
    sources: ["tiktok", "instagram"],
    endpoints: {
      search: "/api/search?q=gojo&source=tiktok",
      all: "/api/search?q=gojo&source=all"
    }
  });
});

function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractResults(html, platform, searchUrl) {
  const results = [];
  const seen = new Set();

  const regex =
    /class=["']result__a["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) && results.length < 10) {
    let videoUrl = cleanText(match[1]);

    try {
      const parsed = new URL(videoUrl, searchUrl);
      const redirect =
        parsed.searchParams.get("uddg") ||
        parsed.searchParams.get("url");

      if (redirect) videoUrl = redirect;
    } catch {
      continue;
    }

    try {
      videoUrl = decodeURIComponent(videoUrl);
    } catch {}

    let parsedUrl;

    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      continue;
    }

    const host = parsedUrl.hostname.toLowerCase();

    const isTikTok =
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com");

    const isInstagram =
      host === "instagram.com" ||
      host.endsWith(".instagram.com");

    if (
      parsedUrl.protocol !== "https:" &&
      parsedUrl.protocol !== "http:"
    ) {
      continue;
    }

    if (platform === "tiktok" && !isTikTok) continue;

    if (
      platform === "instagram" &&
      (!isInstagram || !/^\/(reel|reels|p)\//i.test(parsedUrl.pathname))
    ) {
      continue;
    }

    parsedUrl.search = "";
    parsedUrl.hash = "";

    const finalUrl = parsedUrl.href.replace(/\/$/, "");

    if (seen.has(finalUrl)) continue;
    seen.add(finalUrl);

    results.push({
      platform,
      title: cleanText(match[2]) || "Anime edit",
      url: finalUrl
    });
  }

  return results;
}

async function searchSource(platform, query) {
  const searchQuery = `${SOURCES[platform]} ${query} anime edit`;

  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(searchQuery);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Search provider returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = extractResults(html, platform, url);

  return {
    platform,
    count: results.length,
    results
  };
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

  if (query.length > 200) {
    return res.status(400).json({
      success: false,
      error: "Search query must be 200 characters or fewer."
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

  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    const platform = platforms[i];

    if (item.status === "fulfilled") {
      results.push(...item.value.results);
    } else {
      errors.push({
        platform,
        error: item.reason?.message || "Search failed"
      });
    }
  }

  res.json({
    success: results.length > 0 || errors.length === 0,
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
