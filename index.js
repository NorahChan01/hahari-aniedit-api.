const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Instagram Edit API",
    status: "online",
    endpoint: "/api/search?q=naruto"
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Enter a search term using ?q=naruto"
    });
  }

  try {
    const searchUrl =
      "https://www.google.com/search?q=" +
      encodeURIComponent(
        `site:instagram.com/reel/ OR site:instagram.com/p/ ${query} anime edit`
      );

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`Google search returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const results = [];
    const seen = new Set();

    const regex =
      /https?:\\?\/\\?\/(?:www\.)?instagram\.com\\?\/(reel|reels|p)\\?\/([A-Za-z0-9_-]+)/gi;

    let match;

    while ((match = regex.exec(html)) && results.length < 20) {
      const url = `https://www.instagram.com/${match[1]}/${match[2]}/`;

      if (seen.has(url)) continue;
      seen.add(url);

      results.push({
        platform: "instagram",
        title: `${query} anime edit`,
        url
      });
    }

    res.json({
      success: results.length > 0,
      query,
      source: "instagram",
      count: results.length,
      results,
      ...(results.length === 0
        ? {
            message:
              "No Instagram edit links found. The search provider may block automated requests."
          }
        : {})
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      query,
      source: "instagram",
      count: 0,
      results: [],
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Instagram Edit API running on port ${PORT}`);
});
