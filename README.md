# OpenTube

Ad-free video site with channels, playlists and an admin panel.
No accounts, no email, no phone verification, no tracking.
Videos, channels, playlists, comments and counters live in PostgreSQL.

## Deploy on Render

1. Put these files in a new GitHub repository.
2. On https://render.com choose New > Blueprint and select the repository.
3. Render asks for `ADMIN_PASSWORD`. Type your admin password there.
   It lives only in Render's environment settings, never in the code or the repo.
4. Click Apply, then open the URL Render gives you.

To change the password later: Render dashboard > your service > Environment >
edit ADMIN_PASSWORD, then save (the service redeploys).

## How it works

- **Channels**: anyone can create one with just a name. You receive a secret
  channel key, shown once. It proves ownership: upload, make playlists and delete
  your own things. Sign in on another device by pasting the key. Only a hash of
  the key is stored on the server.
- **Playlists**: owners create playlists on their channel and save any video to them.
  Playlists autoplay in order.
- **Admin**: the Admin button logs in with ADMIN_PASSWORD. Admins can delete any
  video, channel, playlist or comment and see storage stats.
- **Viewer extras**: subscriptions, liked videos, history, resume where you left off,
  playback speed, theater mode and keyboard shortcuts. These are stored per browser.

## How the admin password is protected

- Read from an environment variable only; removed from `process.env` after startup;
  only a SHA-256 hash is kept in memory. Never written to the database, logs or browser.
- Compared in constant time. Login attempts are rate limited (8 per 15 minutes per IP)
  and failures are delayed.
- Sessions use a signed, HttpOnly, SameSite=Strict, Secure cookie that expires in 2 hours.
- Strict Content-Security-Policy, no inline scripts, and all text is escaped in the page.

## Settings

| Name | Meaning |
|------|---------|
| DATABASE_URL | PostgreSQL connection string (Render fills it in) |
| ADMIN_PASSWORD | Admin login password. Leave unset to disable admin |
| SESSION_SECRET | Signs admin sessions (Render generates it) |
| MAX_MB | Largest upload in MB (default 50) |
| DATABASE_SSL | Set to 1 if your database needs SSL |

## Run locally

    npm install
    DATABASE_URL=postgres://user:pass@localhost:5432/opentube ADMIN_PASSWORD=choose-one npm start

Open http://localhost:3000

## Notes

- Videos are stored in the database. Short clips work best; check your Render
  database plan's storage and expiry limits.
- Free web services sleep when idle, so the first visit can be slow. Admin
  sessions reset when the service restarts unless SESSION_SECRET is set.
