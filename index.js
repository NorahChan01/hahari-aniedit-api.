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
      error: "Provide a search term using ?q=naruto"
    });
  }

  const apiKey = process.env.SCRAPECREATORS_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "Missing SCRAPECREATORS_API_KEY environment variable"
    });
  }

  try {
    const url = new URL(
      "https://api.scrapecreators.com/v2/instagram/reels/search"
    );
    url.searchParams.set("query", query);

    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(25000)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        query,
        error: data.message || data.error || "Instagram search provider failed",
        details: data
      });
    }

    const items = Array.isArray(data)
      ? data
      : data.reels || data.results || data.data || data.items || [];

    const results = items
      .map(item => ({
        platform: "instagram",
        title: item.caption || item.title || `${query} anime edit`,
        url: item.url || item.permalink || item.share_url ||
          item.shortcode_url || "",
        videoUrl: item.video_url || item.videoUrl || null
      }))
      .filter(item =>
        typeof item.url === "string" &&
        /^https?:\/\/(www\.)?instagram\.com\//i.test(item.url)
      );

    res.json({
      success: true,
      query,
      source: "instagram",
      count: results.length,
      results
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      query,
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hahari Instagram Edit API running on port ${PORT}`);
});
