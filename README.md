# Open Ear

An anonymous advice board. Visitors post what they are dealing with, with no account and no name. Only you (the host) can publish advice. The original poster can add anonymous follow-ups through a private key kept in their own browser.

## Run it on your computer

    ADMIN_PASSWORD="Jitterbug202!" HOST_NAME="Shan" node server.js

Open http://localhost:3000, click "Host", and sign in with your password. Open any post to reply.

Optional settings: SITE_NAME, PORT, DATA_FILE, SESSION_SECRET.

## Put it online for free

1. Create a GitHub repository and upload these files.
2. On Render (render.com), choose New > Web Service, connect the repository.
3. Build command: leave empty. Start command: `node server.js`.
4. Add environment variables: ADMIN_PASSWORD, HOST_NAME, SITE_NAME, SESSION_SECRET (any long random text).
5. Important: free hosts erase the disk on restart. Either add a persistent disk and set DATA_FILE to its path (for example /var/data/data.json), or ask for the database upgrade (see below).

## Privacy and safety built in

- No accounts, no cookies for visitors, no IP addresses saved (rate limiting uses a temporary in-memory hash).
- Only the host can reply or delete. Visitors cannot reply to each other, which keeps the space calm.
- All user text is rendered as plain text, so scripts cannot be injected.
- A crisis line notice (988) appears on every page.

## Ideas for later

Email notification to you for new posts, a moderation queue before posts go public, a "wise words of the week" page, SQLite or Postgres storage.
