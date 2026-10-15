const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const SOURCES = {
tiktok: "site:tiktok.com",
instagram: "site:instagram.com/reel/"
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
"${SOURCES[platform]} "${query}" anime edit";

const searchUrl =
"https://html.duckduckgo.com/html/?q=" +
encodeURIComponent(searchQuery);

const response = await fetch(searchUrl, {
headers: {
"User-Agent":
"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
},
signal: AbortSignal.timeout(15000)
});

if (!response.ok) {
throw new Error("Search provider returned HTTP ${response.status}");
}

const html = await response.text();
const results = [];
const regex =
/class="result__a"[^>]href="([^"]+)"[^>]>([\s\S]*?)</a>/gi;

let match;

while ((match = regex.exec(html)) && results.length < 10) {
let url = match[1];

try {
  const parsed = new URL(url, searchUrl);
  url = parsed.searchParams.get("uddg") || url;
} catch {}

try {
  url = decodeURIComponent(url);
} catch {}

let parsed;

try {
  parsed = new URL(url);
} catch {
  continue;
}

const host = parsed.hostname.toLowerCase();

const valid = platform === "tiktok"
  ? host === "tiktok.com" || host.endsWith(".tiktok.com")
  : (host === "instagram.com" ||
     host.endsWith(".instagram.com")) &&
    /^\/(reel|p)\//.test(parsed.pathname);

if (!valid || parsed.protocol !== "https:") continue;

const title = match[2]
  .replace(/<[^>]*>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .trim();

if (!results.some(item => item.url === parsed.href)) {
  results.push({
    platform,
    title,
    url: parsed.href
  });
}

}

return results;
}

app.get("/api/search", async (req, res) => {
const query = String(req.query.q || "").trim();
const source = String(req.query.source || "all").toLowerCase();

if (!query || query.length > 150) {
return res.status(400).json({
success: false,
error: "Provide a search query between 1 and 150 characters."
});
}

if (!["all", "tiktok", "instagram"].includes(source)) {
return res.status(400).json({
success: false,
error: "Source must be all, tiktok, or instagram."
});
}

const platforms = source === "all"
? ["tiktok", "instagram"]
: [source];

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
success: true,
query,
source,
count: results.length,
results,
errors
});
});

app.listen(PORT, "0.0.0.0", () => {
console.log("Hahari Anime Edit API running on ${PORT}");
});
