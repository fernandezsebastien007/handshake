import { test, expect, type Page } from "@playwright/test";

// UI contract tests use intercepted Supabase endpoints. RLS/lifecycle behavior is
// independently exercised against actual PostgreSQL by npm run test:db.
const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const C = "00000000-0000-0000-0000-000000000012";
const token = "a".repeat(64);
const alice = {
  id: A,
  username: "alice",
  display_name: "Alice",
  bio: "",
  avatar_url: "",
};
const bob = {
  id: B,
  username: "bob",
  display_name: "Bob",
  bio: "Community gardener",
  avatar_url: "",
};
const user = {
  id: A,
  aud: "authenticated",
  role: "authenticated",
  email: "alice@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};
const session = {
  access_token:
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEifQ.fake",
  token_type: "bearer",
  expires_in: 3600,
  refresh_token: "test-refresh-only",
  user,
};

async function backend(
  page: Page,
  options: {
    connected?: boolean;
    noProfile?: boolean;
    loginFails?: boolean;
    pending?: boolean;
  } = {},
) {
  const writes: { path: string; body: any; method: string }[] = [];
  let profiles = options.noProfile
    ? []
    : options.connected
      ? [alice, bob]
      : [alice];
  let connections = options.connected
    ? [
        {
          id: C,
          user_low: A,
          user_high: B,
          created_at: new Date().toISOString(),
        },
      ]
    : [];
  let notes: any[] = [];
  let contacts: any[] = [
    {
      id: "contact1",
      owner_id: A,
      kind: "email",
      label: "Personal email",
      value: "alice@example.test",
      share_default: false,
    },
  ];
  let overrides: any[] = [];
  let pending: any[] = options.pending
    ? [
        {
          id: C,
          incoming: true,
          username: "bob",
          display_name: "Bob",
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
      ]
    : [];
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = request.postDataJSON();
    if (method !== "GET") writes.push({ path, body, method });
    let response: any = null;
    let status = 200;
    if (path.endsWith("/token")) {
      if (options.loginFails) {
        status = 400;
        response = {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
          msg: "Invalid login credentials",
        };
      } else response = session;
    } else if (path.endsWith("/user")) response = user;
    else if (path.endsWith("/logout")) {
      status = 204;
    } else if (path.endsWith("/signup") || path.endsWith("/recover"))
      response = { user, session: null };
    else if (path.endsWith("/rpc/create_invite"))
      response = {
        token,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      };
    else if (path.endsWith("/rpc/preview_invite"))
      response = {
        username: "bob",
        display_name: "Bob",
        expires_at: new Date(Date.now() + 600000).toISOString(),
      };
    else if (path.endsWith("/rpc/claim_invite")) {
      response = C;
      pending = [
        {
          id: C,
          incoming: false,
          username: "bob",
          display_name: "Bob",
          expires_at: new Date(Date.now() + 600000).toISOString(),
        },
      ];
    } else if (path.endsWith("/rpc/respond_handshake")) {
      if (body.approve) {
        connections = [
          {
            id: C,
            user_low: A,
            user_high: B,
            created_at: new Date().toISOString(),
          },
        ];
        profiles = [alice, bob];
      }
      pending = [];
    } else if (path.endsWith("/rpc/remove_connection")) {
      connections = [];
      profiles = [alice];
      notes = [];
      overrides = [];
    } else if (path.endsWith("/rpc/pending_handshakes")) response = pending;
    else if (path.endsWith("/profiles")) {
      if (method === "POST") profiles = [body];
      response = method === "GET" ? profiles : null;
    } else if (path.endsWith("/connections")) response = connections;
    else if (path.endsWith("/connection_notes")) {
      if (method === "POST") notes = [body];
      response = method === "GET" ? notes : null;
    } else if (path.endsWith("/contact_methods")) {
      if (method === "POST") contacts.push({ id: "newcontact", ...body });
      if (method === "PATCH")
        contacts = contacts.map((c) => ({ ...c, ...body }));
      response = method === "GET" ? contacts : null;
    } else if (path.endsWith("/contact_overrides")) {
      if (method === "POST") overrides = [body];
      if (method === "DELETE") overrides = [];
      response = method === "GET" ? overrides : null;
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: status === 204 ? undefined : JSON.stringify(response),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  return writes;
}
async function login(page: Page, hash = "") {
  await page.goto(`/${hash}`);
  await page.getByLabel("Email", { exact: true }).fill("alice@example.test");
  await page.getByLabel(/^Password/).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("sign in, private empty directory, and sign out", async ({ page }) => {
  await backend(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Your next connection starts here" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your next connection starts here" }),
  ).toHaveCount(0);
});
test("invalid credentials remain on sign-in form", async ({ page }) => {
  await backend(page, { loginFails: true });
  await login(page);
  await expect(page.getByRole("alert")).toHaveText("Invalid login credentials");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});
test("registration asks for email confirmation", async ({ page }) => {
  const writes = await backend(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill("alice@example.test");
  await page.getByLabel(/^Password/).fill("test-password-only");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  expect(writes.some((w) => w.path.endsWith("/signup"))).toBeTruthy();
});
test("first sign-in creates a private profile", async ({ page }) => {
  await backend(page, { noProfile: true });
  await login(page);
  await page.getByLabel("Username", { exact: false }).fill("alice");
  await page.getByLabel("Display name", { exact: true }).fill("Alice");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Your connections" }),
  ).toBeVisible();
});
test("generate QR and reject unrelated links", async ({ page }) => {
  await backend(page);
  await login(page, "#/exchange");
  await page
    .getByRole("button", { name: "Generate Handshake code", exact: true })
    .click();
  await expect(page.getByLabel("Your Handshake link")).toHaveValue(
    `http://localhost:4173/#/handshake/${token}`,
  );
  await expect(page.locator("svg")).toBeVisible();
  await page
    .getByLabel("Or paste a Handshake link")
    .fill("https://example.com");
  await page.getByRole("button", { name: "Review Handshake" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Use a Handshake link from this app",
  );
});
test("link survives sign-in and requests without exposing full profile", async ({
  page,
}) => {
  const writes = await backend(page);
  await login(page, `#/handshake/${token}`);
  await expect(
    page.getByRole("heading", { name: "Bob", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Community gardener")).toHaveCount(0);
  await page.getByRole("button", { name: "Request Handshake" }).click();
  await expect(
    page.getByText("Waiting for their approval.", { exact: false }),
  ).toBeVisible();
  expect(
    writes.some(
      (w) => w.path.endsWith("/rpc/claim_invite") && w.body.raw_token === token,
    ),
  ).toBeTruthy();
});
test("creator approves a request and sees the new connection", async ({
  page,
}) => {
  await backend(page, { pending: true });
  await login(page, "#/exchange");
  await page.getByRole("button", { name: "Approve Handshake" }).click();
  await page
    .getByRole("link", { name: "Connections", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Bob", exact: true }),
  ).toBeVisible();
});
test("directory notes, search, sharing overrides, and removal", async ({
  page,
}) => {
  const writes = await backend(page, { connected: true });
  await login(page);
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Bob", exact: true }) })
    .click();
  await page
    .getByLabel("Private notes", { exact: true })
    .fill("Met at a fictional workshop");
  await page.getByLabel("Tags", { exact: false }).fill("garden, friends");
  await page.getByRole("button", { name: "Save notes & tags" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page
    .getByLabel("Share Personal email", { exact: true })
    .selectOption("true");
  await expect(page.getByRole("status")).toContainText("saved");
  expect(
    writes.some(
      (w) =>
        w.path.endsWith("/contact_overrides") &&
        w.body.recipient_id === B &&
        w.body.allowed === true,
    ),
  ).toBeTruthy();
  await page
    .getByLabel("Share Personal email", { exact: true })
    .selectOption("false");
  await expect(page.getByRole("status")).toContainText("saved");
  await page.getByRole("link", { name: "All connections" }).click();
  await page.getByLabel("Search your connections").fill("workshop");
  await expect(
    page.getByRole("heading", { name: "Bob", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search your connections")
    .fill("no matching connection");
  await expect(
    page.getByRole("heading", { name: "No connections match" }),
  ).toBeVisible();
  await page.getByLabel("Search your connections").fill("");
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Bob", exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(
    page.getByRole("heading", { name: "Your next connection starts here" }),
  ).toBeVisible();
});
test("contact sharing starts unchecked and is configurable", async ({
  page,
}) => {
  const writes = await backend(page);
  await login(page, "#/profile");
  await expect(
    page.getByLabel("Share with all connections by default"),
  ).not.toBeChecked();
  await page.getByLabel("Label", { exact: true }).fill("Work");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("work@example.test");
  await page.getByRole("button", { name: "Add contact method" }).click();
  await expect(
    page.getByText("work@example.test", { exact: true }),
  ).toBeVisible();
  expect(
    writes.some(
      (w) =>
        w.path.endsWith("/contact_methods") && w.body.share_default === false,
    ),
  ).toBeTruthy();
});
test("installable manifest, static cache boundary, and offline fallback", async ({
  page,
  context,
}) => {
  await backend(page);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Your connections" }),
  ).toBeVisible();
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(
    manifest.icons.some(
      (icon: any) => icon.sizes === "512x512" && icon.purpose === "maskable",
    ),
  ).toBeTruthy();
  for (const icon of manifest.icons)
    expect((await page.request.get(`/${icon.src}`)).ok()).toBeTruthy();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A prompt-mode SW controls the page on its next navigation after first install.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your connections" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBeTruthy();
  const keys = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((r) => r.url),
        ),
      )
    ).flat(),
  );
  expect(keys.some((key) => key.includes("supabase.co"))).toBeFalsy();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A moment to reconnect." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your connections" }),
  ).toHaveCount(0);
});
test("mobile layout has no horizontal overflow", async ({ page }, testInfo) => {
  await backend(page, { connected: true });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Your connections" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-directory.png`,
    fullPage: true,
  });
});
