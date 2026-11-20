# OpenTube

Ad-free video site with channels, playlists, an admin panel, a custom video player, and optional RTMP live streaming for OBS Studio.

Videos, channels, playlists, comments, counters and live-stream credentials are stored in PostgreSQL. Live video is handled by a separate MediaMTX server; the Node app on Render manages channels and authenticates stream publishers.

## Deploy the OpenTube app on Render

1. Put this folder in a GitHub repository.
2. On Render choose **New > Blueprint** and select the repository (or create a Node web service with `npm install` and `npm start`).
3. Attach PostgreSQL and set `DATABASE_URL`.
4. Set `ADMIN_PASSWORD` and `SESSION_SECRET` as required by your deployment.
5. For live streaming, after deploying the MediaMTX VPS, set these three environment variables in the OpenTube Render service:
   - `STREAM_AUTH_SECRET`: a long random secret (same value used in the MediaMTX `.env` file).
   - `RTMP_PUBLIC_URL`: `rtmp://YOUR_STREAM_DOMAIN:1935/live`
   - `HLS_PUBLIC_URL`: `https://YOUR_STREAM_DOMAIN`
6. Redeploy the OpenTube service after changing environment variables.

The app automatically creates the `live_streams` PostgreSQL table on startup.

## Set up the RTMP server (required for live streaming)

Render web services do not expose a public raw TCP RTMP listener. Run MediaMTX on a VPS with a public IPv4 address. This ZIP includes `docker-compose.yml`, `mediamtx.yml`, and `Caddyfile` for that server.

1. Choose a domain or subdomain, for example `stream.example.com`, and create an **A record** pointing to the VPS public IP.
2. Install Docker Engine and the Docker Compose plugin on the VPS.
3. Copy `docker-compose.yml`, `mediamtx.yml`, `Caddyfile`, and `.env.example` to the VPS. Rename `.env.example` to `.env`.
4. Generate a random secret on the VPS:

   ```bash
   openssl rand -hex 32
   ```

5. Put the secret into the `.env` file as the value of `REPLACE_WITH_THE_SAME_RANDOM_SECRET` in `MTX_AUTH_HTTP_URL`. Put your real Render app URL in that same setting. Example:

   ```env
   MTX_AUTH_HTTP_URL=https://your-opentube.onrender.com/api/stream-auth?secret=YOUR_LONG_RANDOM_SECRET
   HLS_DOMAIN=stream.example.com
   ```

6. In Render, set `STREAM_AUTH_SECRET` to **the exact same secret**, `RTMP_PUBLIC_URL` to `rtmp://stream.example.com:1935/live`, and `HLS_PUBLIC_URL` to `https://stream.example.com`. Redeploy OpenTube.
7. On the VPS, run:

   ```bash
   docker compose up -d
   ```

8. Allow inbound TCP ports **80, 443 and 1935** in the VPS firewall. Caddy obtains and renews the HTTPS certificate for HLS automatically. Do not expose MediaMTX's HLS port 8888 directly to the public internet; Caddy proxies it over HTTPS.

The VPS must be able to reach your Render app over HTTPS for MediaMTX's authentication webhook. OpenTube must be reachable by MediaMTX for publish/read authentication checks.

## Use OBS Studio

1. Open OpenTube, sign in with your channel key, and choose **Live** in the left navigation.
2. Set a title and choose the target quality, then create the stream. OpenTube shows the RTMP server and the private stream key once.
3. In OBS open **Settings > Stream**:
   - Service: **Custom...**
   - Server: copy the RTMP server from OpenTube.
   - Stream Key: copy the complete key from OpenTube.
4. In OBS open **Settings > Output** and set Output Mode to Advanced or Simple. Use the selected quality as a guide, then set the encoder and bitrate below. Start with H.264, CBR, and a 2-second keyframe interval. AAC audio is recommended.
5. Click **Start Streaming** in OBS. Share the OpenTube public watch page (`#live-CHANNEL_ID`) with viewers.

### Suggested OBS video settings

These are starting points, not enforced server-side limits. Your encoder, upload speed, audience bandwidth and VPS capacity must support the chosen quality.

| Target | Resolution | Suggested video bitrate | FPS |
|---|---:|---:|---:|
| 480p | 854×480 | 1,000–2,500 kbps | 30 or 60 |
| 720p | 1280×720 | 2,500–5,000 kbps | 30 or 60 |
| 1080p | 1920×1080 | 4,500–8,000 kbps | 30 or 60 |
| 1440p | 2560×1440 | 9,000–18,000 kbps | 30 or 60 |
| 4K | 3840×2160 | 20,000–35,000 kbps | 30 or 60 |

**4K is not guaranteed by selecting 4K in OpenTube.** It depends on the broadcaster's encoder, sustained upload speed, VPS CPU/network capacity, and viewer bandwidth. This setup forwards the incoming stream; it does not transcode one input into multiple qualities or create adaptive bitrate renditions.

## Security notes

- Channel keys are hashed in PostgreSQL. Stream keys are also stored as hashes and are shown only when first created or regenerated.
- OBS authenticates using the channel ID and private stream key. MediaMTX checks each publish request against the OpenTube authentication endpoint.
- Viewers can read HLS streams publicly. Never share the OBS stream key; regenerate it from the Live page if it is exposed.
- Keep `.env` private. Do not commit it to GitHub. `.gitignore` excludes it.
- Use a firewall and keep Docker/MediaMTX updated. The sample exposes RTMP (1935) and Caddy HTTP/HTTPS (80/443) only.

## Existing features

- Channels with private channel keys, video uploads, playlists, comments, likes and view counts.
- Admin panel with channel/video moderation and storage stats.
- Custom OpenTube player: seek timeline, volume, mute, loop, picture-in-picture, fullscreen, theater mode and playback speeds.
- Viewer extras: subscriptions, liked videos, history, resume position, autoplay next and keyboard shortcuts.
- Live: OBS RTMP ingest, private stream keys, public HLS playback and quality presets through 4K.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_PASSWORD` | Admin login password |
| `SESSION_SECRET` | Signs admin sessions |
| `MAX_MB` | Maximum uploaded video size in MB (default 50) |
| `DATABASE_SSL` | Set to `1` if PostgreSQL requires SSL |
| `STREAM_AUTH_SECRET` | Shared secret for MediaMTX authentication webhook |
| `RTMP_PUBLIC_URL` | Public RTMP server URL, ending in `/live` |
| `HLS_PUBLIC_URL` | Public HTTPS base URL for HLS playback |

## Run the Node app locally

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/opentube ADMIN_PASSWORD=choose-one npm start
```

Open `http://localhost:3000`. Live streaming also requires the separately configured MediaMTX server.


## Shorts, dislikes and Premieres

- **Shorts detection:** when a channel uploads a video, the browser reads its actual video dimensions and duration. Portrait videos with a height/width ratio of at least 1.25 and a duration of 3 minutes or less are automatically marked as Shorts and shown in the Shorts section. The player uses a portrait layout for them.
- **Likes and dislikes:** each browser gets an anonymous viewer ID stored in local storage. A viewer can switch between Like, Dislike, or no vote; the database stores one vote per video and viewer ID. Clearing browser storage creates a new anonymous ID, so this is not an account-level anti-abuse system.
- **Premieres:** during upload, set a future local date and time in “Schedule a Premiere”. The video is uploaded and stored immediately, appears in the Premieres section, and its playback stays private until the scheduled time. The channel owner can preview/manage the scheduled upload.
- Existing video likes are migrated into legacy vote rows on startup so their displayed like totals are retained.

## Upload/storage limits

Videos are stored inside PostgreSQL in this version. `MAX_MB` controls the per-file upload cap. Uploads are buffered in memory and PostgreSQL/Render have finite RAM, request, database-size and bandwidth limits. Large libraries need object storage plus a streaming upload path; no hosted service provides literally unlimited storage.
