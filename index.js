const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

const EXCLUDE =
  /\b(commentary|commentating|reacts?|reaction|review|explained|news|podcast|interview|discussion|analysis|breakdown|trailer|watch along)\b/i;

const EDIT =
  /\b(anime edit|anime edits|amv|edit|edits|fancam|velocity edit|phonk edit|animeedit|animeedits|manga edit)\b/i;

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Instagram Anime Edit API",
    status: "online",
    endpoint: "/api/search?q=naruto"
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const apiKey = process.env.SCRAPECREATORS_API_KEY;

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Provide a search term using ?q=naruto"
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "Missing SCRAPECREATORS_API_KEY"
    });
  }

  const cacheKey = query.toLowerCase();

  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    res.set("X-Cache", "HIT");
    return res.json(cached.data);
  }

  try {
    const url = new URL(
      "https://api.scrapecreators.com/v2/instagram/reels/search"
    );

    url.searchParams.set(
      "query",
      `${query} anime edit AMV #animeedit`
    );
    url.searchParams.set("page", "1");

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

    const results = reels
      .filter(item => {
        const caption = String(item.caption || "");

        if (!item.video_url || item.is_video === false) {
          return false;
        }

        if (EXCLUDE.test(caption)) {
          return false;
        }

        return EDIT.test(caption);
      })
      .map(item => ({
        title: String(item.caption || `${query} anime edit`)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200),
        video: item.video_url
      }));

    const output = {
      success: true,
      query,
      count: results.length,
      results
    };

    cache.set(cacheKey, {
      data: output,
      expiresAt: Date.now() + CACHE_TTL
    });

    // Prevent unlimited cache growth.
    if (cache.size > 200) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }

    res.set("X-Cache", "MISS");
    return res.json(output);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Instagram Anime Edit API running on ${PORT}`);
});
