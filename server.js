import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import YTdownload from "@hoangquyet/ytdown";

const app = express();
const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*";

app.use(cors({
  origin: ALLOWED_ORIGINS === "*"
    ? "*"
    : ALLOWED_ORIGINS.split(",").map(x => x.trim()),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "1mb" }));

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const hosts = [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "www.youtu.be"
    ];
    return hosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || error.error || String(error);
}

function isRateLimitError(error) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("sign in to confirm") ||
    message.includes("not a bot")
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanFilename(name) {
  return String(name || "video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "video";
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "YTDown API",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy"
  });
});

app.post("/api/info", async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "YouTube URL is required."
    });
  }

  if (!isYouTubeUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid YouTube URL."
    });
  }

  try {
    const info = await YTdownload.info(url);

    return res.json({
      success: true,
      videoId: info.videoId || null,
      title: info.title || "YouTube video",
      author: info.author || null,
      channelId: info.channelId || null,
      durationSeconds: info.durationSeconds ?? null,
      viewCount: info.viewCount ?? null,
      publishDate: info.publishDate || null,
      isLive: Boolean(info.isLive),
      thumbnails: info.thumbnails || [],
      bestVideo: info.bestVideo || null,
      bestAudio: info.bestAudio || null
    });
  } catch (error) {
    console.error("INFO ERROR:", getErrorMessage(error));

    if (isRateLimitError(error)) {
      return res.status(429).json({
        success: false,
        error: "YouTube is temporarily rate-limiting this server. Please try again later."
      });
    }

    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
});

app.post("/api/formats", async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "YouTube URL is required."
    });
  }

  if (!isYouTubeUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid YouTube URL."
    });
  }

  try {
    const formats = await YTdownload.formats(url);

    const normalized = (formats || []).map(format => ({
      itag: format.itag ?? null,
      kind: format.kind || null,
      muxed: Boolean(format.muxed),
      height: format.height ?? null,
      width: format.width ?? null,
      qualityLabel: format.qualityLabel || null,
      codecs: format.codecs || null,
      bitrate: format.bitrate ?? null,
      contentLength: format.contentLength ?? null
    }));

    return res.json({
      success: true,
      formats: normalized
    });
  } catch (error) {
    console.error("FORMATS ERROR:", getErrorMessage(error));

    if (isRateLimitError(error)) {
      return res.status(429).json({
        success: false,
        error: "YouTube is temporarily rate-limiting this server. Please try again later."
      });
    }

    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
});

app.post("/api/download", async (req, res) => {
  const {
    url,
    quality = "best",
    audioOnly = false,
    mp3 = false
  } = req.body || {};

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "YouTube URL is required."
    });
  }

  if (!isYouTubeUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid YouTube URL."
    });
  }

  const allowedQualities = [
    "best", "audio", "144", "240", "360",
    "480", "720", "1080", "1440", "2160"
  ];

  if (!allowedQualities.includes(String(quality))) {
    return res.status(400).json({
      success: false,
      error: "Unsupported quality."
    });
  }

  const jobId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `ytdown-${jobId}`);

  await fs.mkdir(tempDir, { recursive: true });

  try {
    console.log(`[${jobId}] Starting download`);
    console.log(`[${jobId}] Quality: ${quality}`);

    const options = {
      quality: audioOnly ? "audio" : String(quality),
      audioOnly: Boolean(audioOnly),
      mp3: Boolean(mp3),
      outputDir: tempDir,
      container: audioOnly && mp3 ? undefined : "mp4",
      transport: "auto",
      headless: true,
      attest: true
    };

    let result;

    try {
      result = await YTdownload.down(url, options);
    } catch (firstError) {
      console.error(
        `[${jobId}] First attempt failed:`,
        getErrorMessage(firstError)
      );

      if (!isRateLimitError(firstError)) {
        throw firstError;
      }

      console.log(
        `[${jobId}] Rate limit detected. Waiting before one retry...`
      );

      await sleep(8000);
      result = await YTdownload.down(url, options);
    }

    if (!result) {
      throw new Error("Downloader returned no result.");
    }

    let outputPath = result.path || null;

    if (!outputPath && result.videoPath) {
      outputPath = result.videoPath;
    }

    if (!outputPath && result.audioPath) {
      outputPath = result.audioPath;
    }

    if (!outputPath) {
      throw new Error("No downloadable file was produced.");
    }

    await fs.access(outputPath);

    const info = result.info || {};
    const title = cleanFilename(info.title || "video");
    const extension = mp3 ? "mp3" : "mp4";
    const filename = `${title}.${extension}`;

    const stat = await fs.stat(outputPath);

    res.setHeader(
      "Content-Type",
      mp3 ? "audio/mpeg" : "video/mp4"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename.replace(/"/g, "")}"`
    );

    res.setHeader("Content-Length", stat.size);

    const { createReadStream } = await import("fs");
    const stream = createReadStream(outputPath);

    stream.on("error", error => {
      console.error(`[${jobId}] Stream error:`, error);

      if (!res.headersSent) {
        res.status(500);
      }

      res.end();
    });

    stream.pipe(res);

    res.on("finish", async () => {
      try {
        await fs.rm(tempDir, {
          recursive: true,
          force: true
        });

        console.log(`[${jobId}] Temporary files removed`);
      } catch (cleanupError) {
        console.error(
          `[${jobId}] Cleanup error:`,
          cleanupError
        );
      }
    });

  } catch (error) {
    console.error(
      `[${jobId}] DOWNLOAD ERROR:`,
      getErrorMessage(error)
    );

    try {
      await fs.rm(tempDir, {
        recursive: true,
        force: true
      });
    } catch {}

    if (isRateLimitError(error)) {
      return res.status(429).json({
        success: false,
        error: "YouTube is temporarily rate-limiting the Render server. Please wait and try again later."
      });
    }

    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`YTDown API running on port ${PORT}`);
});
