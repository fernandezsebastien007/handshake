# RainbowFlush Clubs host

Intended structure:

- `rainbowflush.com` — existing WordPress site; leave its DNS and hosting unchanged.
- `clubs.rainbowflush.com/` — small Clubs landing page from `site/`.
- `clubs.rainbowflush.com/handshake/` — the existing Handshake project Pages site.

The root-site repository is `fernandezsebastien007/fernandezsebastien007.github.io`. The landing page runs no service worker, so Handshake's worker remains scoped to `/handshake/`. Do not set `clubs.rainbowflush.com` as a custom domain on the **handshake project repository**: doing that would serve the app at the domain root rather than the requested `/handshake/` path. GitHub's documented [user-site custom-domain inheritance](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) gives project sites their `/repository/` paths automatically.

## Domain setup

Public DNS checks on November 16, 2026 showed `rainbowflush.com` using `ns1.dreamhost.com`, `ns2.dreamhost.com`, and `ns3.dreamhost.com`; `clubs.rainbowflush.com` had no address/CNAME record. No DreamHost credentials are available to the development tools.

1. In the owning GitHub account's **Settings → Pages**, add `clubs.rainbowflush.com` for verification. GitHub generates a TXT record. In DreamHost **Manage Websites → rainbowflush.com → DNS Settings**, add exactly that TXT record and complete verification in GitHub. Keep the TXT record afterward. The generated value must come from GitHub; do not invent it.
2. Publish the `site/` contents at the root of the user-site repository, with Pages using `main` and `/`. This is a separate root site; the Handshake repository and its `/handshake/` build base remain unchanged.
3. Set the **root site's** Pages custom domain to `clubs.rainbowflush.com`. Keep that setting in its root `CNAME` file too.
4. In DreamHost, add:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | `clubs` | `fernandezsebastien007.github.io` |

   This CNAME target has **no** `https://` or `/handshake/` path. Keep the main domain, `www`, mail records, and nameservers unchanged. Do not put the whole WordPress domain into “DNS Only” mode. If DreamHost reports a conflict, inspect the `clubs` records rather than removing unrelated records. Use the panel's default TTL.
5. Wait for DNS and GitHub's certificate provisioning. In the root site's Pages settings, enable **Enforce HTTPS** once available. Verify both the landing page and app, including the project site's manifest, icons, worker scope, and a QR link with its hash route. Do not label the custom domain live until HTTPS verification succeeds.
6. In Supabase **Authentication → URL Configuration**, set Site URL to `https://clubs.rainbowflush.com/handshake/`; add that same exact URL as an allowed redirect. Keep the previous GitHub Pages URL and localhost as allowed redirects during transition. The owner must update the dashboard; the public app key cannot change Auth settings.

GitHub redirects the old user/project site addresses to the inherited custom-domain addresses. Verify that these redirects preserve Handshake fragments before sharing the new link widely. Existing signed-in sessions and installed PWAs belong to the old origin: users need to sign in on the new domain and install it again. Supabase accounts, connections, and notes stay in the same database.

## Status and future updates

The `site/` files are the source for the Clubs landing page. The DNS record and domain verification require owner action; this document alone does not configure DNS. Keep working application links on the existing Pages site until the domain change is ready.

To update the landing page, copy `site/index.html` and `.nojekyll` into the root-site checkout, commit, and push. Preserve the root site's `CNAME` file once domain setup is complete. For Handshake updates, use its existing manual Pages workflow with `VITE_BASE_PATH=/handshake/` and its public Supabase variables.

Provider references: [DreamHost custom DNS records](https://help.dreamhost.com/hc/en-us/articles/360035516812-Adding-custom-DNS-records), [GitHub domain verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages).
