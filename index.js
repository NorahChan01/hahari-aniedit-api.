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
headers: { "User-Agent": "Mozilla/5.0" },
signal: AbortSignal.timeout(15000)
});

if (!response.ok) {
throw new Error("Search provider returned HTTP " + response.status);
}

const html = await response.text();
const results = [];
const chunks = html.split('class="result__a"').slice(1);

for (const chunk of chunks) {
if (results.length >= 10) break;

const hrefStart = chunk.indexOf('href="');
if (hrefStart === -1) continue;

const hrefValueStart = hrefStart + 6;
const hrefEnd = chunk.indexOf('"', hrefValueStart);
if (hrefEnd === -1) continue;

let resultUrl = chunk.slice(hrefValueStart, hrefEnd);

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
  !["/reel/", "/reels/", "/p/"].some(path =>
    parsedUrl.pathname.startsWith(path)
  )
) continue;

if (results.some(item => item.url === parsedUrl.href)) continue;

const titleStart = chunk.indexOf(">");
const titleEnd = chunk.indexOf("</a>");

let title = "Anime edit video";

if (titleStart !== -1 && titleEnd > titleStart) {
  title = chunk.slice(titleStart + 1, titleEnd)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

results.push({
  platform,
  title,
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
query,
source,
count: results.length,
results,
errors
});
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Hahari Anime Edit API running on port " + PORT);
});
