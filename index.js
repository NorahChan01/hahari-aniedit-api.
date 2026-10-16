const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const MAX_PAGE = 11;
const BATCH_SIZE = 9;

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Instagram Anime Edit API",
    status: "online",
    endpoint: "/api/search?q=alya",
    batchSize: BATCH_SIZE,
    maxPage: MAX_PAGE
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  const refresh = String(req.query.refresh || "") === "1";
  const page = Number.parseInt(req.query.page || "1", 10);

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Provide a search term using ?q=alya"
    });
  }

  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return res.status(400).json({
      success: false,
      error: `Page must be between 1 and ${MAX_PAGE}`
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "Missing SCRAPECREATORS_API_KEY"
    });
  }

  const cacheKey = `${query.toLowerCase()}|${page}`;
  const cached = cache.get(cacheKey);

  if (!refresh && cached && Date.now() < cached.expiresAt) {
    res.set("X-Cache", "HIT");
    return res.json(cached.data);
  }

  try {
    const url = new URL(
      "https://api.scrapecreators.com/v2/instagram/reels/search"
    );

    url.searchParams.set("query", `${query} anime edit AMV`);
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(25000)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || "Instagram search failed"
      });
    }

    const reels = Array.isArray(data.reels) ? data.reels : [];
    const seen = new Set();
    const results = [];

    for (const item of reels) {
      const video = item.video_url;

      if (
        typeof video !== "string" ||
        !/^https?:\/\//i.test(video) ||
        item.is_video === false ||
        seen.has(video)
      ) {
        continue;
      }

      seen.add(video);

      results.push({
        title: String(item.caption || `${query} Anime Edit`)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200),
        video
      });

      if (results.length >= BATCH_SIZE) break;
    }

    const output = {
      success: true,
      query,
      page,
      count: results.length,
      results
    };

    cache.set(cacheKey, {
      data: output,
      expiresAt: Date.now() + CACHE_TTL
    });

    while (cache.size > MAX_CACHE_SIZE) {
      cache.delete(cache.keys().next().value);
    }

    res.set("X-Cache", refresh ? "REFRESHED" : "MISS");
    return res.json(output);
  } catch (error) {
    console.error("[API SEARCH ERROR]", error.message);

    return res.status(502).json({
      success: false,
      error: "Instagram search failed"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Instagram Anime Edit API running on ${PORT}`);
});
