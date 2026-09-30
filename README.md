# YTDown Render API

A standalone YouTube downloader API for an existing frontend.

This implementation uses `@hoangquyet/ytdown` rather than yt-dlp. The package is an InnerTube/SABR-based downloader. It requires Node.js 18+; FFmpeg is needed when separate video/audio tracks have to be muxed. Chrome/Chromium is included in the Docker image for the package's fallback path.

## Endpoints

### GET /health

```json
{"ok":true,"status":"healthy"}
```

### POST /api/info

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Returns title, author, thumbnail information, duration and best formats.

### POST /api/formats

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Returns available formats so your frontend can build a quality selector.

### POST /api/download

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "quality": "720"
}
```

Supported quality values:

- best
- 144
- 240
- 360
- 480
- 720
- 1080
- 1440
- 2160
- audio

Audio:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "audioOnly": true,
  "mp3": true
}
```

The API streams the generated file to the frontend and removes its temporary server-side files afterward.

## Render deployment

### Option A — Docker (recommended)

1. Push this repository to GitHub.
2. Render → New → Web Service.
3. Connect the GitHub repository.
4. Select Docker as the runtime.
5. Deploy.

The Dockerfile installs:

- Node 22
- FFmpeg
- Chromium
- the downloader package

### Option B — Native Node service

If you use Render's native Node runtime:

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

For the most consistent fallback support, Docker is recommended because it installs FFmpeg and Chromium together.

## Frontend integration

Set:

```javascript
const API = "https://YOUR-SERVICE.onrender.com";
```

Get information:

```javascript
const response = await fetch(`${API}/api/info`, {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({url: youtubeUrl})
});

const data = await response.json();
console.log(data);
```

Get qualities:

```javascript
const response = await fetch(`${API}/api/formats`, {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({url: youtubeUrl})
});

const data = await response.json();
```

Download:

```javascript
const response = await fetch(`${API}/api/download`, {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({
    url: youtubeUrl,
    quality: "720"
  })
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(error.error || "Download failed");
}

const blob = await response.blob();
const downloadUrl = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = downloadUrl;
a.download = "video.mp4";
document.body.appendChild(a);
a.click();
a.remove();

URL.revokeObjectURL(downloadUrl);
```

## CORS

For initial testing, Render's `ALLOWED_ORIGINS=*` allows your frontend to connect.

For production, change the Render environment variable to your actual frontend origin:

```text
https://yourdomain.com
```

For multiple origins:

```text
https://yourdomain.com,https://www.yourdomain.com
```

## Important

No downloader can honestly guarantee that every YouTube video will work forever. YouTube can change its delivery protocol, restrict particular videos, or require authentication/attestation.

This service is intended for public videos that the user is authorized to download. Do not use it to bypass DRM, access controls, or other technical restrictions.

For a public service, add rate limiting/authentication before sharing the API widely. Render resources and YouTube/network restrictions can become the bottleneck with many simultaneous downloads.
