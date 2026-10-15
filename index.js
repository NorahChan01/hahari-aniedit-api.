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

const DOWNLOAD_DIR = path.join(
  os.tmpdir(),
  "hahari-aniedit-downloads"
);

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

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

let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = 1;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

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
    if (pos === 0 || /\s/.test(tag[pos - 1])) {
      let start = pos + key.length;
      const quote = tag[start];

      if (quote === '"' || quote === "'") {
        start++;
        const end = tag.indexOf(quote, start);
        return end === -1 ? "" : tag.slice(start, end);
      }

      let end = start;

      while (end < tag.length && !/[\s>]/.test(tag[end])) {
        end++;
      }

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
    const urlPath = parsed.pathname.toLowerCase();

    const isTikTok =
      host === "tiktok.com" || host.endsWith(".tiktok.com");

    const isInstagram =
      host === "instagram.com" ||
      host.endsWith(".instagram.com");

    if (platform === "tiktok" && !isTikTok) continue;
    if (platform === "instagram" && !isInstagram) continue;

    if (platform === "tiktok" && !urlPath.includes("/video/")) {
      continue;
    }

    if (
      platform === "instagram" &&
      !urlPath.startsWith("/reel/") &&
      !urlPath.startsWith("/reels/") &&
      !urlPath.startsWith("/p/")
    ) {
      continue;
    }

    parsed.hash = "";
    const finalUrl = parsed.href;

    if (results.some(item => item.url === finalUrl)) continue;

    results.push({
      platform,
      title: (cleanText(content) || "Anime edit video").slice(0, 250),
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
      Accept:
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

  const searchQuery = site + " " + query + " anime edit";

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

function validateVideoUrl(value) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  const urlPath = parsed.pathname.toLowerCase();

  const isTikTok =
    host === "tiktok.com" || host.endsWith(".tiktok.com");

  const isInstagram =
    host === "instagram.com" ||
    host.endsWith(".instagram.com");

  if (isTikTok && urlPath.includes("/video/")) {
    return { url: parsed.href, platform: "tiktok" };
  }

  if (
    isInstagram &&
    (urlPath.startsWith("/reel/") ||
      urlPath.startsWith("/reels/") ||
      urlPath.startsWith("/p/"))
  ) {
    return { url: parsed.href, platform: "instagram" };
  }

  return null;
}

async function removeDownloadFiles(id) {
  try {
    const names = await fsp.readdir(DOWNLOAD_DIR);

    await Promise.all(
      names
        .filter(name => name.startsWith(id + "."))
        .map(name =>
          fsp.unlink(path.join(DOWNLOAD_DIR, name)).catch(() => {})
        )
    );
  } catch {}
}

app.get("/", (req, res) => {
  res.json({
    name: "Hahari Anime Edit API",
    status: "online",
    paidApiKeysRequired: false,
    endpoints: {
      search: "/api/search?q=gojo&source=all",
      download:
        "/api/download?url=ENCODED_PUBLIC_TIKTOK_OR_INSTAGRAM_URL"
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

app.get("/api/download", async (req, res) => {
  const inputUrl = String(req.query.url || "");
  const validated = validateVideoUrl(inputUrl);

  if (!validated) {
    return res.status(400).json({
      success: false,
      error:
        "Provide a valid public TikTok video or Instagram Reel URL."
    });
  }

  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return res.status(429).json({
      success: false,
      error: "A download is already running. Try again shortly."
    });
  }

  activeDownloads++;

  const id = crypto.randomBytes(12).toString("hex");
  const outputTemplate = path.join(
    DOWNLOAD_DIR,
    id + ".%(ext)s"
  );

  try {
    await youtubedl(
      validated.url,
      {
        noPlaylist: true,
        noWarnings: true,
        noProgress: true,
        format: "best[ext=mp4]/best",
        output: outputTemplate,
        maxFilesize: "20M",
        socketTimeout: 20,
        retries: 1
      },
      {
        timeout: 65000
      }
    );

    const names = await fsp.readdir(DOWNLOAD_DIR);

    const candidates = names.filter(name =>
      name.startsWith(id + ".") &&
      !name.endsWith(".part")
    );

    if (!candidates.length) {
      throw new Error("The platform did not provide a downloadable video.");
    }

    const filePath = path.join(DOWNLOAD_DIR, candidates[0]);
    const stats = await fsp.stat(filePath);

    if (!stats.isFile() || stats.size === 0) {
      throw new Error("The downloaded file is empty.");
    }

    if (stats.size > MAX_VIDEO_BYTES) {
      throw new Error("The video exceeds the 20 MB download limit.");
    }

    const extension = path.extname(filePath).toLowerCase();

    res.setHeader("Content-Length", stats.size);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="hahari-anime-edit' +
        (extension || ".mp4") +
        '"'
    );

    res.setHeader(
      "Content-Type",
      extension === ".webm" ? "video/webm" : "video/mp4"
    );

    const stream = fs.createReadStream(filePath);

    stream.on("error", async error => {
      console.error("Video stream error:", error.message);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Could not stream the downloaded video."
        });
      } else {
        res.destroy(error);
      }
    });

    stream.on("close", () => {
      removeDownloadFiles(id);
    });

    res.on("close", () => {
      removeDownloadFiles(id);
    });

    stream.pipe(res);
  } catch (error) {
    await removeDownloadFiles(id);

    console.error("Download failed:", error.message);

    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        platform: validated.platform,
        error:
          "Download failed. The platform may block the server, " +
          "the video may be private, or the video may be unavailable."
      });
    }
  } finally {
    activeDownloads--;
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Hahari Anime Edit API running on port " + PORT);
});
