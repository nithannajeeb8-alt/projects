# Gmail Experience-Application Sender & Tracker

Private, review-first software for sending individual experience or job applications from a user’s own Gmail account. It accepts user-entered company email addresses, creates separate emails, attaches one selected PDF resume per campaign, tracks Gmail replies, and never sends until the user has approved recipients and confirmed the batch.

## What is implemented

- Google OAuth sign-in; the sender is always the Gmail account that granted access.
- Encrypted refresh/access tokens and encrypted resume storage. Local encrypted storage is for development; configure the included S3 settings for a private production bucket.
- Campaign creation, CSV/manual recipient input, duplicate prevention, editable per-recipient messages, approval, and a 25-per-day sending guard.
- Individual Gmail MIME messages with a PDF attachment; no recipient is disclosed to another recipient.
- Gmail thread-based reply synchronization, authenticated Pub/Sub webhook support, scheduled reconciliation, and reply labels for interview, rejection, bounce, opt-out, and other replies.
- Optional, explicit per-campaign OpenAI Responses API suggestions. The app passes no data to OpenAI until the user checks consent; generated text is an editable suggestion only.
- Browser notification permission button, account disconnect, and encrypted-resume cleanup.

## Start locally

1. Copy `.env.example` to `.env.local`, create a PostgreSQL database, and set strong random values for `APP_SESSION_SECRET`, `DATA_ENCRYPTION_KEY` (a base64-encoded 32-byte key), and `CRON_SECRET`.
2. In Google Cloud, create a Web OAuth client. Add `http://localhost:3000/api/auth/google/callback` as its development redirect URI, enable the Gmail API, and put the client values in `.env.local`.
3. Run `npm install`, `npm run db:generate`, `npm run db:migrate`, then `npm run dev`.
4. For AI suggestions, add `OPENAI_API_KEY`; omit it to keep template-only drafting. The implementation uses the official [Responses API](https://developers.openai.com/api/docs).

## Production requirements

- Serve over HTTPS and set `APP_URL` to the final public URL.
- Configure a private S3-compatible bucket and KMS/key policy, or replace the development filesystem storage adapter before deploying.
- Create the Pub/Sub topic, grant Gmail publish permission, configure a push subscription using the listed OIDC audience and service account, and schedule `POST /api/jobs/sync` with `Authorization: Bearer $CRON_SECRET` at least hourly.
- Complete Google OAuth verification and its restricted Gmail-scope requirements before opening access beyond testing. Keep the Google OAuth scopes limited to `gmail.send` and `gmail.readonly`.
- Add a privacy notice, retention policy, abuse monitoring, and operational alerting before a public launch.

## Safety boundaries

The app does not discover email addresses, scrape sites, request Gmail passwords, impersonate a sender, use CC/BCC, automatically follow up, or automatically send AI-written text. The applicant must review each claim, attachment, recipient, and final batch.
