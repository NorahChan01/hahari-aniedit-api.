const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCES = {
tiktok: "site:tiktok.com",
instagram: "site:instagram.com"
};

app.get("/", (req, res) => {
res.json({
name: "Hahari Anime Edit API",
status: "online",
sources: ["tiktok", "instagram"]
});
});

async function searchPlatform(platform, query) {
const searchQuery =
SOURCES[platform] + ' "' + query + '" anime edit';

const searchUrl =
"https://html.duckduckgo.com/html/?q=" +
encodeURIComponent(searchQuery);

const response = await fetch(searchUrl, {
headers: {
"User-Agent": "Mozilla/5.0"
},
signal: AbortSignal.timeout(15000)
});

if (!response.ok) {
throw new Error("Search provider returned HTTP " + response.status);
}

const html = await response.text();
const results = [];
const regex =
/class="result__a"[^>]href="([^"]+)"[^>]>([\s\S]*?)</a>/gi;

let match;

while ((match = regex.exec(html)) && results.length < 10) {
let resultUrl = match[1];

try {
  const parsed = new URL(resultUrl, searchUrl);
  resultUrl = parsed.searchParams.get("uddg") || resultUrl;
} catch {}

try {
  resultUrl = decodeURIComponent(resultUrl);
} catch {}

let parsedUrl;

try {
  parsedUrl = new URL(resultUrl);
} catch {
  continue;
}

if (parsedUrl.protocol !== "https:") continue;

const host = parsedUrl.hostname.toLowerCase();

const isTikTok =
  host === "tiktok.com" || host.endsWith(".tiktok.com");

const isInstagram =
  host === "instagram.com" || host.endsWith(".instagram.com");

if (platform === "tiktok" && !isTikTok) continue;
if (platform === "instagram" && !isInstagram) continue;

if (
  platform === "instagram" &&
  !/^\/(reel|reels|p)\//.test(parsedUrl.pathname)
) continue;

if (results.some(item => item.url === parsedUrl.href)) continue;

const title = match[2]
  .replace(/<[^>]*>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

results.push({
  platform: platform,
  title: title,
  url: parsedUrl.href
});

}

return results;
}

app.get("/api/search", async (req, res) => {
const query = String(req.query.q || "").trim();
const source = String(req.query.source || "all").toLowerCase();

if (!query || query.length > 150) {
return res.status(400).json({
success: false,
error: "Provide a query between 1 and 150 characters."
});
}

if (!["all", "tiktok", "instagram"].includes(source)) {
return res.status(400).json({
success: false,
error: "Source must be all, tiktok, or instagram."
});
}

const platforms =
source === "all" ? ["tiktok", "instagram"] : [source];

const settled = await Promise.allSettled(
platforms.map(platform => searchPlatform(platform, query))
);

const results = [];
const errors = [];

settled.forEach((item, index) => {
if (item.status === "fulfilled") {
results.push(...item.value);
} else {
errors.push({
platform: platforms[index],
error: item.reason.message
});
}
});

res.json({
success: errors.length < platforms.length,
query: query,
source: source,
count: results.length,
results: results,
errors: errors
});
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Hahari Anime Edit API running on port " + PORT);
});
