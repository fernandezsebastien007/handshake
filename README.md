# Handshake PWA · v0.1

A mobile-first React/TypeScript/Vite prototype for private, mutual real-world connections. “Handshake” names the connection action; the product name is provisional. No public directory, DMs, feeds, calls, native app, or phone-to-phone NFC.

## Hosted prototype

The owner approved GitHub Pages deployment. The source repository is [fernandezsebastien007/handshake](https://github.com/fernandezsebastien007/handshake). The live prototype is **https://fernandezsebastien007.github.io/handshake/**. The repository contains application source and placeholder configuration, not the local `.env` or user account data. Public Supabase configuration is supplied through GitHub Actions repository variables.

Deployment succeeded on November 16, 2026. All 5 unit tests, 53 PostgreSQL security/lifecycle checks, 22 browser tests, and the production build passed in GitHub Actions. A separate browser check against the actual HTTPS site verified sign-in/registration screens, the real Supabase configuration and reachable Auth settings, manifest/icons under `/handshake/`, mobile layout, service-worker control, and offline reload without caching Supabase responses. No real signup was submitted by the automated hosted-site check; email confirmation and two physical phones still need manual verification.

In Supabase Authentication → URL Configuration, set Site URL to `https://fernandezsebastien007.github.io/handshake/`, add that same exact URL to Redirect URLs, and retain `http://localhost:5173/` as a development redirect. The trailing slash and `/handshake/` path are required. This dashboard change requires owner access; frontend configuration cannot change it.

## Implemented

- Supabase email/password registration, confirmation, sign-in, persistent sessions, sign-out, password recovery, and unique private profiles.
- Ten-minute, 256-bit random QR/link invitations; only SHA-256 hashes stored in PostgreSQL. A recipient explicitly requests and the creator explicitly approves. The token is consumed on requesting; final approval must also happen before the same ten-minute deadline.
- Server-enforced expiry, single consumption, replay rejection, duplicate prevention, request cancellation/decline, and connection removal.
- Private searchable directories, per-owner notes/tags, profile descriptions, and optional HTTPS picture URLs.
- Email, phone, and HTTPS contact methods, private by default; recipient-specific allow/deny overrides; revocation on future reads.
- Profile/contact/notes deletion and authenticated account deletion with dependent-row cleanup.
- Installable manifest, PNG and maskable icons, standalone display, app updates on request, static shell caching, and an offline fallback that hides directory data.

The frontend calls the real Supabase APIs. Without configuration it displays setup instructions; there is no simulated account mode in the application.

## Prerequisites

- Node.js 22.12+ (Node 24 recommended), npm.
- A **new dedicated Supabase project**, created by the owner. Never paste privileged keys into the app.
- Docker Desktop for the isolated PostgreSQL security suite. These tests require the `postgres:16-alpine` image (Docker can download it).
- HTTPS for phone installation and camera scanning. `localhost` is trusted for desktop development; a phone visiting a plain HTTP LAN address is not equivalent to localhost.

Windows PowerShell may block `npm.ps1`; use `npm.cmd` / `npx.cmd` in the commands below if needed. Changing your execution policy is unnecessary.

## Setup and local development

1. Install dependencies:

   ```sh
   npm ci
   ```

2. In the Supabase SQL editor of the dedicated project, run the complete contents of [the initial migration](supabase/migrations/202611160001_initial.sql) **once**. It creates seven RLS-protected tables, restricted RPCs, and a private policy-helper schema. It is not an idempotent script. Do not run it over an unrelated existing schema. Future schema changes should be new, ordered migration files.

   Alternatively, with the Supabase CLI installed, use `supabase link --project-ref YOUR_PROJECT_REF` and `supabase db push`. Review the linked project before applying. The owner has already run the initial migration successfully through the hosted SQL editor for this prototype; do not run it again on that project.

3. Copy `.env.example` to `.env` and replace placeholders:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
   VITE_BASE_PATH=/
   ```

   Use the project’s **publishable** key (or legacy `anon` key). These are intentionally public client configuration; RLS is the authorization boundary. Never use a service-role key, secret key, database password, or personal access token in any `VITE_` variable. Vite bundles every exposed variable into public JS. `.env` files are ignored.

4. In Supabase Authentication settings:

   - Enable email/password signup and email confirmation. Set the minimum password length to at least 12 to match the registration UI.
   - Set the development Site URL and allowed redirect URL to `http://localhost:5173/`.
   - When an HTTPS test/production URL exists, add its exact URL **including the repository base path and trailing slash** to allowed redirects. Use it as the Site URL for that environment.
   - Configure email delivery and inspect Auth rate limits. Hosted trial email delivery may restrict recipients; use authorized test accounts and configure SMTP if required. Never disable confirmation to conceal a delivery problem.
   - For a private prototype, disable signup after creating the test accounts if appropriate. Turn on Auth CAPTCHA/stronger abuse controls before a public beta; the UI currently does not provide a CAPTCHA token.

5. Start:

   ```sh
   npm run dev
   ```

   Open `http://localhost:5173/`. Register, confirm email, sign in, and choose an unused username. Profiles are created **after** authenticated email confirmation, not by an unrestricted signup trigger. Open the original Handshake link again if email confirmation opened a separate tab.

6. For a production PWA build on your machine:

   ```sh
   npm run build
   npm run preview
   ```

   Open the printed localhost preview URL. Service workers are generated in production builds, not the normal Vite dev server. When switching test builds on the same origin, clear the old service worker/site data or accept the update prompt. Never publish the browser test build: the test runner deliberately builds with a fake public Supabase project.

Optional: `supabase start` uses `supabase/config.toml` for a full local Supabase stack. Use its printed API URL/public key in `.env` and `supabase db reset` to apply migrations. Confirmation mail is available in the CLI’s local mail viewer. This full local stack has not been exercised here; the database tests below use PostgreSQL directly.

## How the Handshake works

1. Alice generates a QR code/link. The database returns a fresh 32-byte token and a ten-minute deadline. It stores its hash, revokes Alice’s previous unused code, and enforces at most 20 codes/hour/user.
2. Bob scans or opens `https://HOST/BASE/#/handshake/TOKEN`, authenticates, and sees Alice’s display name/username and expiry only. Profiles and contact methods remain inaccessible.
3. Bob presses **Request Handshake**. A transaction locks the token, verifies expiry/self/duplicate conditions, consumes it once, and creates a pending request. Bob is limited to 40 requests/hour. Pair locks serialize reciprocal requests. Merely previewing does not consume the token.
4. Alice sees Bob’s minimal identity and approves or declines. Only Alice can approve; either participant can cancel/decline a pending request. Approval after the original ten-minute deadline fails. Accepted pairs are stored in canonical UUID order with a unique constraint.
5. Only then do both directories show the other profile. Defaults and overrides determine each contact method’s visibility independently.
6. Either participant can remove the connection. Both lose profile/contact access, notes are deleted, and per-pair sharing overrides are cleared. Reconnecting requires a new mutual Handshake; global contact defaults still apply.

Hash routes work directly on GitHub Pages without server rewrites. Future NFC tags can open exactly these HTTPS URLs; no Web NFC or NFC emulation is implemented. Link tokens stay out of HTTP URL paths/query strings and referrer headers, but anyone with the link can request until it is used/expired. Always confirm the requester before approving. A consumed code can still appear on the creator’s screen until refresh/new generation; attempting reuse is denied server-side.

## Privacy and security model

All seven application tables have RLS. Anonymous users have no app table/RPC grants. Authenticated users cannot insert/update accepted connections, invitations, or request state directly. Only scoped, authenticated `SECURITY DEFINER` functions with fixed empty search paths perform those operations. Their execute grants are explicitly restricted. Private helpers derive the acting user from `auth.uid()`, never from a trusted browser-supplied user ID.

Profiles are readable only by their owner and accepted peers. A valid invitation or pending request reveals only the minimum confirmation fields through a scoped RPC. Usernames are unique but not searchable publicly; uniqueness errors can reveal whether a chosen username is taken. Notes and tags are strictly owner-only, even from the connected person. Contact reads require an active connection and an explicit override or enabled default. An explicit deny overrides an enabled default; an explicit allow overrides a private default. Removing an override restores the current default.

The service worker caches **only static build assets**. It does not cache Supabase HTTP responses, private profiles, notes, contact methods, or QR secrets. No analytics or contact logging is included. React escapes user text. Link contacts require HTTPS; phone/email values are validated in both database constraints and UI link construction. External picture URLs are optional; their hosts receive image requests from accepted viewers (no referrer is sent). Picture uploads/storage are not implemented.

Supabase’s browser client persists the session in origin-local storage and refreshes it automatically. It is not an HttpOnly-cookie design; protect this origin from XSS and do not use shared untrusted devices for private data. Sign-out clears the client session and in-memory data; account deletion cascades the identity and related database rows. Offline transitions hide/clear directory data. Already received details can remain in a person’s memory, browser tab, or copied files; revocation cannot recall them. Open visible tabs refresh every 15 seconds, on visibility changes, and after actions; refresh to see another person’s revocation sooner. Data responses are not cached for offline use.

`delete_my_account()` intentionally deletes the authenticated Auth identity. Application-owned rows cascade, including connections and notes. It does not delete copies held by peers, external hosted pictures, or provider backups/logs under their retention policies. Set and disclose retention periods, provide a support/removal path, verify the actual Supabase Auth cascade and storage behavior, and review export/deletion handling before any public beta. No real personal contact data was used during development.

## Automated checks

```sh
npm test                 # Input boundaries / safe error messages
npm run build            # Strict TypeScript + Vite + production service worker
npm run test:db          # Real PostgreSQL 16 RLS and lifecycle checks via Docker
npx playwright install chromium
npm run test:e2e         # Production-build mobile + desktop Chromium UI/PWA tests
npm audit
```

The database runner creates a disposable container bound to a random **loopback-only** port with a non-production password, applies the actual migration, creates a minimal `auth.users`/`auth.uid()` fixture and `anon`/`authenticated` roles, and executes queries as those restricted roles. It always stops its container on completion. It never reads `.env` or connects to a live Supabase database. It covers cross-user profile/notes/contact denial, unsafe links, forged approvals, token hash storage, expiry, replay, duplicate connections, concurrent consumption, sharing defaults/overrides/revocation, removal, rate limits, account deletion, and RLS coverage.

Browser tests intercept Supabase HTTP endpoints with fictional fixture data to check UI contracts: registration/login failures/sign-out, profile onboarding, QR/link flow, approvals, directory search/notes, recipient overrides, contact defaults, manifest/icons, cache boundaries, offline reload, and phone viewport overflow. They do **not** prove hosted Auth delivery, real camera permission, or real Supabase HTTP integration. The PostgreSQL fixture is likewise not a full Supabase Auth server. Do the manual test below before declaring v0.1 complete.

The lockfile is tracked. A narrow `workbox-build` → `glob` override uses a patched version for build-tool advisories; the production PWA build validates compatibility. Icons are checked in; regenerate with `node scripts/generate-icons.mjs` after editing `public/icon.svg`.

## Two phones and a third-account privacy test

Use fictional contacts (`alice@example.test`, etc.) for stored contact methods. Auth accounts must use owner-authorized test email addresses that can receive confirmation messages.

1. Configure an HTTPS app origin and the matching Supabase redirect URLs. Publishing or tunneling the prototype requires explicit owner approval; this repository has not been published. The static frontend can be public while all account data stays access-controlled in Supabase.
2. On phone A (Safari on iPhone) and phone B (Chrome on Android), open the same base URL. Create different accounts, confirm their emails, sign in, and choose distinct usernames. Add descriptions so you can verify they are hidden before approval.
3. Install: on iOS use **Share → Add to Home Screen**; on Android use **Install app** / **Add to Home screen**. Open from each icon and confirm standalone layout and persisted sign-in. Browser installation availability varies by OS/browser.
4. On A, open **Handshake → Generate Handshake code**. On B, use the in-app scanner (allow camera) or the system camera. Also test **Copy link**, manual select/copy fallback, and pasting the link. Camera denial must still allow a pasted link.
5. B should see A’s name and username only. B presses **Request Handshake**. Before A approves, neither should see the other’s full profile/contact methods in the directory. On A, use Refresh if needed and verify the expected requester before approving within ten minutes.
6. Both now see the other profile in **Connections**. On A add a private note and tags; search by name, note, and tag. Confirm B cannot see A’s note/tags.
7. On A add a private contact method. B should not see it. Set its default to shared; B refreshes and sees it. In A’s connection detail set **Keep private from this person**; B refreshes and loses access. Set default private and the recipient override to **Share with this person**; only B receives it. Test **Use default** and revocation again.
8. In a separate browser/device use account C. C must not see A or B’s profiles, connection, notes, contacts, or request rows. Using C’s JWT/public project key, query the Data API directly with known IDs (through a local client, without logging tokens): results should be empty/denied. Anonymous reads/RPCs must be denied. UI hiding alone is not a sufficient test.
9. Replay a consumed link from B and C; it must fail. Try your own code, a new code for an already-connected pair, a superseded code, an unused code after ten minutes, and approval of an expired pending request. None may create a new connection. Decline/cancel a request and verify it cannot later be approved. A new successful exchange must use a fresh code and both approvals.
10. Remove the connection from B. A and B lose profile/contact access on the next read, and notes/overrides are gone. Reconnect to check defaults are applied and old overrides/notes do not reappear.
11. Visit the production build once online, close/reopen/reload offline, and verify the fallback hides private data and prevents Handshake actions. Reconnect and refresh; authentication should restore normally. Check email password recovery, sign-out, and re-login. Email confirmation/recovery links may open in the browser rather than the installed PWA.
12. On a disposable test account, use **Profile & privacy → Delete my account**, type `DELETE`, and confirm. Verify its auth identity and related rows are removed, peers lose access, and the old session cannot read or recreate the deleted profile. Review provider backups/retention separately.

## Optional GitHub Pages deployment (owner approval required)

The repository and initial GitHub Pages deployment are owner-approved. The workflow at `.github/workflows/pages.yml` is **manual only**; pushing source never publishes this app. Future deployments still use that workflow. Use the repository and exact URL above rather than creating a second repository for this prototype.

1. Create/select an owner-approved GitHub repository and commit the source, `package-lock.json`, and icons. Never commit `.env`. Git initialization/pushing is left to the owner’s chosen repository setup.
2. Set GitHub Actions repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_BASE_PATH`. These are public config, not privileged secrets. Set base to `/REPOSITORY_NAME/` for `https://USERNAME.github.io/REPOSITORY_NAME/`, or `/` for an account site/custom domain. Match case exactly.
3. In repository Settings → Pages, choose **GitHub Actions**. Add the resulting exact HTTPS URL with base path and trailing slash to Supabase Auth redirect settings. Configure the intended email Site URL. If using a custom domain, configure its DNS and HTTPS before phone testing.
4. After approval, manually run **Deploy approved prototype** from Actions. It builds and uploads only `dist/`. The workflow refuses empty public project variables and runs unit, PostgreSQL, and browser checks before rebuilding with the owner’s public config.
5. Confirm asset/manifest/service-worker URLs respect the base path, open a Handshake link directly from a phone, and complete the full manual test above. Updates prompt users to save edits before refreshing. Nothing in a Pages build can keep a secret; all authorization must remain in Supabase.

Vite’s official [static deployment guidance](https://vite.dev/guide/static-deploy) explains the repository base path. The database follows Supabase’s [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [database function security](https://supabase.com/docs/guides/database/functions) guidance.

## Structure

```text
src/                    UI, Supabase client, input helpers, unit tests
public/                 App icons (no personal assets)
supabase/migrations/    Schema, RLS, trusted lifecycle functions
supabase/config.toml    Optional local Supabase settings
scripts/test-db.mjs      Disposable PostgreSQL security test runner
scripts/generate-icons.mjs
tests/                  Mocked HTTP UI/PWA browser tests
.github/workflows/      Checks; manual deployment only
```

## Remaining verification and prototype limits

The app has been configured with the owner's public Supabase URL/key. Live checks confirmed that Auth is reachable, email signup is enabled with confirmation required, anonymous profile reads are denied, and the local setup screen is replaced by sign-in. The owner reports creating an account. No privileged Supabase credentials are available to the app or development tools. Hosted redirect settings still require owner dashboard configuration as described above.

Full local Supabase HTTP integration, iOS/Android installation, real camera scanning, and two actual phones have **not** been verified. The automated suites are meaningful local checks, but are not the complete definition of done. Real email confirmation and the hosted two-account flow require manual verification.

The directory currently reads the project API’s first response page (typically up to 1,000 records); pagination is needed for larger directories. Contact values can be deleted/re-added; inline value editing and image uploads are not implemented. Polling replaces realtime infrastructure. Unsaved form edits are local to the open screen and can be lost on navigation/update. Expired requests/invites remain stored (inaccessible to other users); add a retention/cleanup schedule before beta. Rate limits are per-account only and do not prevent mass-account abuse or preview traffic. A public beta also needs a security review, stronger abuse controls, operational monitoring without sensitive logs, provider retention decisions, and real-device accessibility testing.
