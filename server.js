import express from "express";
import cors from "cors";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import YTdownload from "@hoangquyet/ytdown";

const app = express();
const PORT = process.env.PORT || 10000;

const origins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

app.use(cors({
  origin: origins.includes("*") ? true : origins,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "1mb" }));

function validYouTubeUrl(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase();
    return [
      "youtube.com", "www.youtube.com", "m.youtube.com",
      "music.youtube.com", "youtu.be", "www.youtu.be",
      "youtube-nocookie.com", "www.youtube-nocookie.com"
    ].includes(host);
  } catch {
    return false;
  }
}

function requireUrl(body) {
  const url = body?.url;
  if (!url || typeof url !== "string" || !validYouTubeUrl(url)) {
    const err = new Error("Please provide a valid YouTube video URL.");
    err.status = 400;
    throw err;
  }
  return url;
}

function cleanName(name) {
  return String(name || "video")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "video";
}

function normalizeFormat(f) {
  return {
    itag: f.itag,
    kind: f.kind,
    muxed: Boolean(f.muxed),
    height: f.height ?? null,
    width: f.width ?? null,
    qualityLabel: f.qualityLabel ?? null,
    fps: f.fps ?? null,
    codecs: f.codecs ?? null,
    bitrate: f.bitrate ?? null,
    contentLength: f.contentLength ?? null,
    mimeType: f.mimeType ?? null
  };
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "YouTube Downloader API",
    endpoints: [
      "GET /health",
      "POST /api/info",
      "POST /api/formats",
      "POST /api/download"
    ]
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "healthy" });
});

app.post("/api/info", async (req, res) => {
  try {
    const url = requireUrl(req.body);
    const info = await YTdownload.info(url);

    res.json({
      success: true,
      videoId: info.videoId,
      title: info.title,
      author: info.author,
      channelId: info.channelId,
      durationSeconds: info.durationSeconds,
      viewCount: info.viewCount,
      publishDate: info.publishDate,
      isLive: info.isLive,
      thumbnails: info.thumbnails,
      bestVideo: info.bestVideo ? normalizeFormat(info.bestVideo) : null,
      bestAudio: info.bestAudio ? normalizeFormat(info.bestAudio) : null
    });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      error: err.message || "Unable to read this video."
    });
  }
});

app.post("/api/formats", async (req, res) => {
  try {
    const url = requireUrl(req.body);
    const formats = await YTdownload.formats(url);

    // Return useful video qualities to the frontend.
    const result = formats
      .map(normalizeFormat)
      .filter(f => f.kind === "video" || f.kind === "audio")
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    res.json({
      success: true,
      formats: result
    });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      error: err.message || "Unable to retrieve formats."
    });
  }
});

app.post("/api/download", async (req, res) => {
  let tempDir = null;

  try {
    const url = requireUrl(req.body);
    const requestedQuality = String(req.body.quality || "best");
    const audioOnly = Boolean(req.body.audioOnly);
    const mp3 = Boolean(req.body.mp3);

    // Only accept sensible quality values from the frontend.
    const allowedQualities = new Set(["best", "audio", "144", "240", "360", "480", "720", "1080", "1440", "2160"]);
    const quality = allowedQualities.has(requestedQuality) ? requestedQuality : "best";

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdown-"));

    const result = await YTdownload.down(url, {
      quality,
      audioOnly,
      mp3: audioOnly && mp3,
      outputDir: tempDir,
      container: audioOnly && mp3 ? undefined : "mp4",
      attest: true
    });

    const filePath = result.path || result.videoPath || result.audioPath;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error("The downloader did not produce a downloadable file.");
    }

    const stat = await fsp.stat(filePath);
    const info = result.info || {};
    const originalTitle = info.title || "video";
    const ext = path.extname(filePath) || (audioOnly && mp3 ? ".mp3" : ".mp4");
    const filename = cleanName(originalTitle) + ext;

    res.setHeader("Content-Type", audioOnly && mp3 ? "audio/mpeg" : "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    res.setHeader("Cache-Control", "no-store");

    const stream = fs.createReadStream(filePath);

    const cleanup = async () => {
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
      } catch {}
    };

    stream.on("error", async () => {
      if (!res.headersSent) res.status(500);
      await cleanup();
    });

    res.on("finish", cleanup);
    res.on("close", cleanup);

    stream.pipe(res);
  } catch (err) {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    res.status(err.status || 400).json({
      success: false,
      error: err.message || "Download failed."
    });
  }
});

// Basic protection against accidentally huge request bodies.
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Endpoint not found." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`YouTube Downloader API listening on port ${PORT}`);
});
