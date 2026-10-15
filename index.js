const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const ENGINES = [
  {
    name: "bing",
    url: q =>
      "https://www.bing.com/search?q=" +
      encodeURIComponent(q) +
      "&count=20"
  },
  {
    name: "google",
    url: q =>
      "https://www.google.com/search?q=" +
      encodeURIComponent(q) +
      "&num=20"
  },
  {
    name: "duckduckgo",
    url: q =>
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(q)
  }
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function getAttribute(tag, name) {
  const lower = tag.toLowerCase();
  const key = name.toLowerCase() + "=";
  let pos = lower.indexOf(key);

  while (pos !== -1) {
    if (pos === 0 || /[\s]/.test(tag[pos - 1])) {
      let start = pos + key.length;
      const quote = tag[start];

      if (quote === '"' || quote === "'") {
        start++;
        const end = tag.indexOf(quote, start);
        return end === -1 ? "" : tag.slice(start, end);
      }

      let end = start;
      while (
        end < tag.length &&
        !/[\s>]/.test(tag[end])
      ) end++;

      return tag.slice(start, end);
    }

    pos = lower.indexOf(key, pos + key.length);
  }

  return "";
}

function cleanText(html) {
  let result = "";
  let insideTag = false;

  for (const char of html) {
    if (char === "<") {
      insideTag = true;
      result += " ";
    } else if (char === ">") {
      insideTag = false;
    } else if (!insideTag) {
      result += char;
    }
  }

  return decodeHtml(result).replace(/\s+/g, " ").trim();
}

function unwrapUrl(value, base) {
  let url = decodeHtml(value);

  try {
    const parsed = new URL(url, base);

    for (const key of ["uddg", "url", "q"]) {
      const redirected = parsed.searchParams.get(key);

      if (
        redirected &&
        (redirected.startsWith("http://") ||
          redirected.startsWith("https://"))
      ) {
        url = redirected;
        break;
      }
    }

    const finalUrl = new URL(url, base);

    if (finalUrl.protocol !== "https:") return null;

    const host = finalUrl.hostname.toLowerCase();

    if (
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "bing.com" ||
      host.endsWith(".bing.com") ||
      host === "duckduckgo.com" ||
      host.endsWith(".duckduckgo.com")
    ) {
      return null;
    }

    return finalUrl;
  } catch {
    return null;
  }
}

function parseAnchors(html, base, platform) {
  const results = [];
  let position = 0;

  while (position < html.length) {
    const start = html.toLowerCase().indexOf("<a ", position);
    if (start === -1) break;

    const tagEnd = html.indexOf(">", start);
    if (tagEnd === -1) break;

    const close = html.toLowerCase().indexOf("</a>", tagEnd);
    if (close === -1) {
      position = tagEnd + 1;
      continue;
    }

    const tag = html.slice(start, tagEnd + 1);
    const content = html.slice(tagEnd + 1, close);
    position = close + 4;

    const rawUrl = getAttribute(tag, "href");
    if (!rawUrl) continue;

    const parsed = unwrapUrl(rawUrl, base);
    if (!parsed) continue;

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    const isTikTok =
      host === "tiktok.com" || host.endsWith(".tiktok.com");

    const isInstagram =
      host === "instagram.com" ||
      host.endsWith(".instagram.com");

    if (platform === "tiktok" && !isTikTok) continue;
    if (platform === "instagram" && !isInstagram) continue;

    if (platform === "tiktok" && !path.includes("/video/")) {
      continue;
    }

    if (
      platform === "instagram" &&
      !path.startsWith("/reel/") &&
      !path.startsWith("/reels/") &&
      !path.startsWith("/p/")
    ) {
      continue;
    }

    parsed.hash = "";
    const finalUrl = parsed.href;

    if (results.some(item => item.url === finalUrl)) continue;

    const title = cleanText(content) || "Anime edit video";

    results.push({
      platform,
      title: title.slice(0, 250),
      url: finalUrl
    });

    if (results.length >= 15) break;
  }

  return results;
}

async function searchEngine(engine, query, platform) {
  const url = engine.url(query);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }

  const html = await response.text();

  if (
    html.toLowerCase().includes("unusual traffic") ||
    html.toLowerCase().includes("captcha")
  ) {
    throw new Error("Search engine blocked the request");
  }

  return parseAnchors(html, url, platform);
}

async function searchPlatform(platform, query) {
  const site =
    platform === "tiktok"
      ? "site:tiktok.com"
      : "site:instagram.com";

  const searchQuery =
    site + " " + query + " anime edit";

  const attempts = await Promise.allSettled(
    ENGINES.map(engine =>
      searchEngine(engine, searchQuery, platform)
    )
  );

  const results = [];
  const errors = [];

  attempts.forEach((attempt, index) => {
    if (attempt.status === "fulfilled") {
      for (const item of attempt.value) {
        if (!results.some(existing => existing.url === item.url)) {
          results.push(item);
        }
      }
    } else {
      errors.push({
        engine: ENGINES[index].name,
        error: attempt.reason.message
      });
    }
  });

  return { results, errors };
}

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Anime Edit API",
    status: "online",
    searchMethod: "Free public search engines",
    paidApiKeysRequired: false,
    endpoints: {
      search: "/api/search?q=gojo&source=all",
      tiktok: "/api/search?q=gojo&source=tiktok",
      instagram: "/api/search?q=gojo&source=instagram"
    }
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const source = String(req.query.source || "all").toLowerCase();

  if (!query || query.length > 100) {
    return res.status(400).json({
      success: false,
      error: "Enter a query between 1 and 100 characters."
    });
  }

  if (!["all", "tiktok", "instagram"].includes(source)) {
    return res.status(400).json({
      success: false,
      error: "Source must be all, tiktok, or instagram."
    });
  }

  try {
    const platforms =
      source === "all" ? ["tiktok", "instagram"] : [source];

    const responses = await Promise.all(
      platforms.map(async platform => ({
        platform,
        ...(await searchPlatform(platform, query))
      }))
    );

    const results = responses.flatMap(item => item.results);
    const errors = responses.flatMap(item =>
      item.errors.map(error => ({
        platform: item.platform,
        ...error
      }))
    );

    res.json({
      success: results.length > 0,
      query,
      source,
      count: results.length,
      results: results.slice(0, 20),
      errors,
      note: results.length
        ? "Results are public links, not downloaded videos."
        : "No results found. Search engines may block requests or have no indexed matches."
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Hahari Anime Edit API running on port " + PORT);
});
