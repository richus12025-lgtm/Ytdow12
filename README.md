# YTDown Render Backend

This is the replacement backend for the YTDown frontend.

## Files

- server.js
- package.json
- Dockerfile
- render.yaml

## Render deployment

1. Create a new GitHub repository.
2. Upload all four files to the repository root.
3. In Render, create a new Web Service from that GitHub repository.
4. Select Docker as the runtime if Render asks.
5. Deploy.
6. Open:
   https://YOUR-RENDER-SERVICE.onrender.com/health

You should receive JSON showing:
{
  "success": true,
  "status": "healthy"
}

## Environment variable

ALLOWED_ORIGINS=*

For production, you can replace * with the origin of the application that calls the API.

## Important

YouTube may return HTTP 429 when the server IP is rate-limited. No downloader can guarantee uninterrupted access because YouTube controls access to its service. The backend uses the package's automatic transport selection and attestation support and performs only one delayed retry when a rate-limit error is detected.

Use the service only for content you are authorized to download.
