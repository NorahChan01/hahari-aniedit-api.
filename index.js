const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.set("trust proxy", 1);

const DOWNLOAD_DIR = path.join(os.tmpdir(), "hahari-aniedit-downloads");
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const MAX_CONCURRENT_DOWNLOADS = 1;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
let activeDownloads = 0;

const ENGINES = [
  {
    name: "google",
    url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=20`
  },
  {
    name: "bing",
    url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`
  },
  {
    name: "duckduckgo",
    url: q => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  }
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function cleanText(html) {
  return decodeHtml(String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp("\\b" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
  return match ? (match[1] || match[2] || match[3] || "") : "";
}

function unwrapUrl(value, base) {
  try {
    let url = decodeHtml(value);
    let parsed = new URL(url, base);

    for (const key of ["uddg", "url", "q"]) {
      const target = parsed.searchParams.get(key);
      if (target && /^https?:\/\//i.test(target)) {
        url = target;
        break;
      }
    }

    parsed = new URL(url, base);

    if (parsed.protocol !== "https:") return null;

    const host = parsed.hostname.toLowerCase();
    if (
      host === "google.com" || host.endsWith(".google.com") ||
      host === "bing.com" || host.endsWith(".bing.com") ||
      host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")
    ) return null;

    return parsed;
  } catch {
    return null;
  }
}

function platformForHost(host) {
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  return null;
}

function isVideoPath(platform, pathname) {
  const p = pathname.toLowerCase();

  if (platform === "tiktok") return /\/video\/\d+/.test(p);
  if (platform === "instagram") {
    return /^\/(reel|reels|p)\/[^/]+/.test(p);
  }

  return false;
}

function parseAnchors(html, base, requestedPlatform) {
  const results = [];
  const seen = new Set();

  // Search engines commonly place titles and links inside <a> elements.
  const anchors = String(html || "").match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];

  for (const anchor of anchors) {
    const openTag = anchor.match(/^<a\b[^>]*>/i)?.[0] || "";
    const rawUrl = getAttribute(openTag, "href");
    if (!rawUrl) continue;

    const parsed = unwrapUrl(rawUrl, base);
    if (!parsed) continue;

    const platform = platformForHost(parsed.hostname.toLowerCase());
    if (!platform || (requestedPlatform !== "all" && platform !== requestedPlatform)) continue;
    if (!isVideoPath(platform, parsed.pathname)) continue;

    parsed.hash = "";
    parsed.search = "";
    const url = parsed.href.replace(/\/$/, "");
    if (seen.has(url)) continue;
    seen.add(url);

    const title = cleanText(anchor).slice(0, 250) || "Anime edit video";
    results.push({ platform, title, url });

    if (results.length >= 15) break;
  }

  return results;
}

async function searchEngine(engine, query, platform) {
  const url = engine.url(query);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  if (/captcha|unusual traffic|before you continue|verify you are human/i.test(html)) {
    throw new Error("Search engine returned a block or consent page");
  }

  const results = parseAnchors(html, url, platform);
  if (!results.length && html.length < 1000) {
    throw new Error("Search engine returned an unexpected response");
  }
  return results;
}

async function searchPlatform(platform, query) {
  const siteQuery = platform === "all"
    ? `(${ "site:tiktok.com OR site:instagram.com" }) "${query}" anime edit`
    : `site:${platform}.com "${query}" anime edit`;

  const attempts = await Promise.allSettled(
    ENGINES.map(engine => searchEngine(engine, siteQuery, platform))
  );

  const results = [];
  const errors = [];

  attempts.forEach((attempt, index) => {
    if (attempt.status === "rejected") {
      errors.push({ engine: ENGINES[index].name, error: String(attempt.reason?.message || attempt.reason) });
      return;
    }

    for (const result of attempt.value) {
      if (!results.some(item => item.url === result.url)) results.push(result);
    }
  });

  return { results, errors };
}

function validateVideoUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;

    const platform = platformForHost(parsed.hostname.toLowerCase());
    if (!platform || !isVideoPath(platform, parsed.pathname)) return null;

    return { url: parsed.href, platform };
  } catch {
    return null;
  }
}

async function removeDownloadFiles(id) {
  try {
    const names = await fsp.readdir(DOWNLOAD_DIR);
    await Promise.all(names
      .filter(name => name.startsWith(id + "."))
      .map(name => fsp.unlink(path.join(DOWNLOAD_DIR, name)).catch(() => {})));
  } catch {}
}

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Anime Edit API",
    status: "online",
    paidApiKeysRequired: false,
    endpoints: {
      search: "/api/search?q=gojo&source=all",
      download: "/api/download?url=ENCODED_PUBLIC_TIKTOK_OR_INSTAGRAM_URL"
    }
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const source = String(req.query.source || "all").toLowerCase();

  if (!query || query.length > 100) {
    return res.status(400).json({ success: false, error: "Enter a query between 1 and 100 characters." });
  }
  if (!["all", "tiktok", "instagram"].includes(source)) {
    return res.status(400).json({ success: false, error: "Source must be all, tiktok, or instagram." });
  }

  try {
    const platforms = source === "all" ? ["tiktok", "instagram"] : [source];
    const responses = await Promise.all(platforms.map(async platform => ({
      platform,
      ...(await searchPlatform(platform, query))
    })));

    const results = responses.flatMap(item => item.results).slice(0, 20);
    const errors = responses.flatMap(item => item.errors.map(error => ({ platform: item.platform, ...error })));

    res.json({
      success: results.length > 0,
      query,
      source,
      count: results.length,
      results,
      errors,
      note: results.length
        ? "Results are public links, not downloaded videos."
        : "No results found. Check errors for blocked engines or try a different query."
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/download", async (req, res) => {
  const validated = validateVideoUrl(String(req.query.url || ""));

  if (!validated) {
    return res.status(400).json({
      success: false,
      error: "Provide a valid public TikTok video or Instagram Reel URL."
    });
  }

  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return res.status(429).json({ success: false, error: "A download is already running. Try again shortly." });
  }

  activeDownloads++;
  const id = crypto.randomBytes(12).toString("hex");
  const outputTemplate = path.join(DOWNLOAD_DIR, id + ".%(ext)s");

  try {
    await youtubedl(validated.url, {
      noPlaylist: true,
      noWarnings: true,
      noProgress: true,
      format: "best[ext=mp4]/best",
      output: outputTemplate,
      maxFilesize: "20M",
      socketTimeout: 20,
      retries: 1
    }, { timeout: 65000 });

    const names = await fsp.readdir(DOWNLOAD_DIR);
    const candidates = names.filter(name => name.startsWith(id + ".") && !name.endsWith(".part"));
    if (!candidates.length) throw new Error("No downloadable video was produced.");

    const filePath = path.join(DOWNLOAD_DIR, candidates[0]);
    const stats = await fsp.stat(filePath);
    if (!stats.isFile() || stats.size === 0) throw new Error("The downloaded file is empty.");
    if (stats.size > MAX_VIDEO_BYTES) throw new Error("The video exceeds the 20 MB limit.");

    const extension = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Content-Disposition", `attachment; filename="hahari-anime-edit${extension || ".mp4"}"`);
    res.setHeader("Content-Type", extension === ".webm" ? "video/webm" : "video/mp4");

    const stream = fs.createReadStream(filePath);
    stream.on("error", error => {
      console.error("Video stream error:", error.message);
      if (!res.headersSent) res.status(500).json({ success: false, error: "Could not stream the downloaded video." });
      else res.destroy(error);
    });
    stream.on("close", () => removeDownloadFiles(id));
    res.on("close", () => removeDownloadFiles(id));
    stream.pipe(res);
  } catch (error) {
    await removeDownloadFiles(id);
    console.error("Download failed:", error.message);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        platform: validated.platform,
        error: "Download failed. The platform may block the server, the video may be private, or the video may be unavailable."
      });
    }
  } finally {
    activeDownloads--;
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Hahari Anime Edit API running on port " + PORT);
});
