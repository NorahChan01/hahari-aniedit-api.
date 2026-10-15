const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

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

try {
const sources = source === "all"
? ["tiktok", "instagram"]
: [source];

const results = await Promise.all(
  sources.map(async (platform) => {
    const searchQuery =
      `${SOURCES[platform]} ${query} anime edit`;

    const url =
      "https://html.duckduckgo.com/html/?q=" +
      encodeURIComponent(searchQuery);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`${platform} search returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const links = [];
    const regex =
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while ((match = regex.exec(html)) && links.length < 10) {
      let videoUrl = match[1];

      try {
        const parsed = new URL(videoUrl, url);
        const redirected = parsed.searchParams.get("uddg");

        if (redirected) videoUrl = redirected;
      } catch {}

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

      const valid = platform === "tiktok"
        ? host === "tiktok.com" || host.endsWith(".tiktok.com")
        : host === "instagram.com" ||
          host.endsWith(".instagram.com");

      if (!valid || !/^https?:$/.test(parsedUrl.protocol)) {
        continue;
      }

      const title = match[2]
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      links.push({
        platform,
        title,
        url: parsedUrl.href
      });
    }

    return { platform, results: links };
  })
);

const videos = results.flatMap(item => item.results);

res.json({
  success: true,
  query,
  source,
  count: videos.length,
  results: videos
});

} catch (error) {
res.status(502).json({
success: false,
error: "Search failed. The search provider may be blocking requests.",
details: error.message
});
}
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Hahari Anime Edit API listening on ${PORT}");
});
