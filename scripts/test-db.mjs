// Real PostgreSQL/RLS tests with a minimal Supabase auth.uid()/auth.users fixture.
// Does not connect to a Supabase account or use real contact information.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";

const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const name = `handshake-tests-${Date.now()}`;
let admin;
let started = false;
let passed = 0;
const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const C = "00000000-0000-0000-0000-000000000003";
const D = "00000000-0000-0000-0000-000000000004";
let connectionString;
function ok(description, value = true) {
  assert.ok(value, description);
  passed++;
  console.log(`  PASS ${description}`);
}
async function asUser(user, sql, values = []) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      user ? "set local role authenticated" : "set local role anon",
    );
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      user ?? "",
    ]);
    const result = await client.query(sql, values);
    await client.query("commit");
    return result.rows;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    await client.end();
  }
}
async function denied(description, user, sql, values = []) {
  await assert.rejects(asUser(user, sql, values));
  ok(description);
}
const scalar = async (user, sql, args) =>
  Object.values((await asUser(user, sql, args))[0])[0];
const invite = (user) => scalar(user, "select public.create_invite()");
const claim = (user, token) =>
  scalar(user, "select public.claim_invite($1)", [token]);
const approve = (user, request) =>
  asUser(user, "select public.respond_handshake($1, true)", [request]);
try {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_PASSWORD=local-test-only",
    "--env",
    "POSTGRES_DB=handshake_test",
    "postgres:16-alpine",
  );
  started = true;
  const port = docker("port", name, "5432/tcp").split(":").at(-1);
  connectionString = `postgresql://postgres:local-test-only@127.0.0.1:${port}/handshake_test`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      admin = new pg.Client({ connectionString });
      await admin.connect();
      break;
    } catch {
      await admin?.end().catch(() => {});
      admin = undefined;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(admin, "PostgreSQL became ready");
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await admin.query(
    await readFile("supabase/migrations/202611160001_initial.sql", "utf8"),
  );
  ok("migration applies to PostgreSQL 16");
  await admin.query("insert into auth.users values ($1), ($2), ($3), ($4)", [
    A,
    B,
    C,
    D,
  ]);
  for (const [id, name] of [
    [A, "alice"],
    [B, "bob"],
    [C, "carol"],
    [D, "dana"],
  ]) {
    await asUser(
      id,
      "insert into public.profiles(id, username, display_name, bio) values ($1, $2, $2, $3)",
      [id, name, "Private description"],
    );
  }
  ok("authenticated users can create their own profile");
  await denied(
    "anonymous users cannot enumerate profiles",
    null,
    "select * from public.profiles",
  );
  await denied(
    "anonymous users cannot mint invitations",
    null,
    "select public.create_invite()",
  );
  ok(
    "unconnected users see only their own profile",
    (await asUser(C, "select * from public.profiles")).length === 1,
  );
  await denied(
    "cannot create someone else’s profile",
    A,
    "insert into public.profiles(id, username, display_name) values ($1, $2, $2)",
    [B, "imposter"],
  );
  await denied(
    "username uniqueness is enforced",
    D,
    "update public.profiles set username = 'alice'",
  );
  ok(
    "cannot update another profile",
    (
      await asUser(
        C,
        "update public.profiles set bio = 'changed' where id = $1 returning id",
        [A],
      )
    ).length === 0,
  );
  await denied(
    "cannot forge an accepted connection",
    C,
    "insert into public.connections(user_low, user_high) values ($1, $2)",
    [A, C],
  );
  await denied(
    "cannot forge a pending request",
    C,
    "insert into public.handshake_requests(inviter_id, invitee_id, expires_at) values ($1,$2,now())",
    [A, C],
  );
  await denied(
    "invitation hashes are not exposed to clients",
    A,
    "select * from public.handshake_invites",
  );
  const first = await invite(A);
  ok("tokens contain 256 random bits", /^[a-f0-9]{64}$/.test(first.token));
  const hashes = (
    await admin.query("select token_hash from public.handshake_invites")
  ).rows;
  ok(
    "only token hashes are stored",
    hashes.length === 1 && hashes[0].token_hash !== first.token,
  );
  const minimal = await scalar(B, "select public.preview_invite($1)", [
    first.token,
  ]);
  ok(
    "pre-acceptance preview exposes only minimal confirmation information",
    Object.keys(minimal).sort().join(",") ===
      "display_name,expires_at,username",
  );
  await denied(
    "own QR cannot create self connection",
    A,
    "select public.claim_invite($1)",
    [first.token],
  );
  const newer = await invite(A);
  await denied(
    "new code invalidates previous unused code",
    B,
    "select public.claim_invite($1)",
    [first.token],
  );
  const request = await claim(B, newer.token);
  ok(
    "claim produces pending request without connecting",
    (await scalar(A, "select count(*)::int from public.connections")) === 0,
  );
  ok(
    "pending recipient cannot read full profile",
    (await asUser(B, "select * from public.profiles where id=$1", [A]))
      .length === 0,
  );
  ok(
    "request list provides names to participants",
    (await scalar(A, "select public.pending_handshakes()"))[0].username ===
      "bob",
  );
  ok(
    "third account cannot enumerate requests",
    (await asUser(C, "select * from public.handshake_requests")).length === 0,
  );
  await denied(
    "used token cannot be replayed",
    C,
    "select public.claim_invite($1)",
    [newer.token],
  );
  await denied(
    "recipient cannot approve for creator",
    B,
    "select public.respond_handshake($1,true)",
    [request],
  );
  await denied(
    "third account cannot approve",
    C,
    "select public.respond_handshake($1,true)",
    [request],
  );
  await approve(A, request);
  const connection = await scalar(A, "select id from public.connections");
  ok("creator approval establishes one connection", Boolean(connection));
  ok(
    "both participants can see accepted profile",
    (await asUser(B, "select * from public.profiles where id=$1", [A]))
      .length === 1,
  );
  ok(
    "third account cannot read accepted pair",
    (await asUser(C, "select * from public.connections")).length === 0,
  );
  await denied(
    "accepted request cannot be replayed",
    A,
    "select public.respond_handshake($1,true)",
    [request],
  );
  const duplicate = await invite(A);
  await denied(
    "duplicate connection is prevented",
    B,
    "select public.claim_invite($1)",
    [duplicate.token],
  );
  await asUser(
    A,
    "insert into public.connection_notes(connection_id,notes,tags) values ($1,$2,$3)",
    [connection, "Met at a fictional event", ["design"]],
  );
  ok(
    "owner can read private notes",
    (await asUser(A, "select * from public.connection_notes")).length === 1,
  );
  ok(
    "peer cannot read private notes",
    (await asUser(B, "select * from public.connection_notes")).length === 0,
  );
  ok(
    "third account cannot read private notes",
    (await asUser(C, "select * from public.connection_notes")).length === 0,
  );
  await denied(
    "cannot write peer’s notes",
    B,
    "insert into public.connection_notes(owner_id,connection_id,notes) values ($1,$2,$3)",
    [A, connection, "forged"],
  );
  await denied(
    "cannot annotate a connection you do not belong to",
    C,
    "insert into public.connection_notes(connection_id,notes) values ($1,$2)",
    [connection, "forged"],
  );
  const contact = await scalar(
    A,
    "insert into public.contact_methods(kind,label,value) values ('email','Test email','alice@example.test') returning id",
  );
  ok(
    "contact defaults to private",
    (await asUser(B, "select * from public.contact_methods")).length === 0,
  );
  await asUser(
    A,
    "update public.contact_methods set share_default=true where id=$1",
    [contact],
  );
  ok(
    "default share allows accepted recipient",
    (await asUser(B, "select * from public.contact_methods")).length === 1,
  );
  ok(
    "default share never allows unconnected stranger",
    (await asUser(C, "select * from public.contact_methods")).length === 0,
  );
  await asUser(A, "insert into public.contact_overrides values ($1,$2,false)", [
    contact,
    B,
  ]);
  ok(
    "deny override revokes default access",
    (await asUser(B, "select * from public.contact_methods")).length === 0,
  );
  await asUser(
    A,
    "update public.contact_methods set share_default=false where id=$1",
    [contact],
  );
  await asUser(
    A,
    "update public.contact_overrides set allowed=true where contact_id=$1",
    [contact],
  );
  ok(
    "allow override grants only intended recipient",
    (await asUser(B, "select * from public.contact_methods")).length === 1 &&
      (await asUser(C, "select * from public.contact_methods")).length === 0,
  );
  await denied(
    "recipient cannot grant themselves sharing",
    B,
    "insert into public.contact_overrides values ($1,$2,true)",
    [contact, B],
  );
  await denied(
    "cannot set sharing to a nonconnection",
    A,
    "insert into public.contact_overrides values ($1,$2,true)",
    [contact, C],
  );
  ok(
    "recipient cannot edit contact values",
    (
      await asUser(
        B,
        "update public.contact_methods set value='forged@example.test' where id=$1 returning id",
        [contact],
      )
    ).length === 0,
  );
  await denied(
    "unsafe contact links are rejected by database",
    A,
    "insert into public.contact_methods(kind,label,value) values ('link','Bad','javascript:alert(1)')",
  );
  await denied(
    "third account cannot remove connection",
    C,
    "select public.remove_connection($1)",
    [connection],
  );
  await asUser(B, "select public.remove_connection($1)", [connection]);
  ok(
    "removal revokes profile access",
    (await asUser(B, "select * from public.profiles where id=$1", [A]))
      .length === 0,
  );
  ok(
    "removal revokes contacts and clears overrides and notes",
    (await asUser(B, "select * from public.contact_methods")).length === 0 &&
      (await asUser(A, "select * from public.contact_overrides")).length ===
        0 &&
      (await asUser(A, "select * from public.connection_notes")).length === 0,
  );
  const expired = await invite(C);
  await admin.query(
    "update public.handshake_invites set expires_at=now()-interval '1 second' where owner_id=$1",
    [C],
  );
  await denied(
    "expired token cannot be previewed",
    B,
    "select public.preview_invite($1)",
    [expired.token],
  );
  await denied(
    "expired token cannot be claimed",
    B,
    "select public.claim_invite($1)",
    [expired.token],
  );
  const late = await invite(C);
  const lateRequest = await claim(B, late.token);
  await admin.query(
    "update public.handshake_requests set expires_at=now()-interval '1 second' where id=$1",
    [lateRequest],
  );
  await denied(
    "expired pending request cannot establish connection",
    C,
    "select public.respond_handshake($1,true)",
    [lateRequest],
  );
  const cancelled = await invite(D);
  const cancelRequest = await claim(B, cancelled.token);
  await asUser(B, "select public.respond_handshake($1,false)", [cancelRequest]);
  await denied(
    "cancelled request cannot be approved later",
    D,
    "select public.respond_handshake($1,true)",
    [cancelRequest],
  );
  const raced = await invite(D);
  const race = await Promise.allSettled([
    claim(A, raced.token),
    claim(C, raced.token),
  ]);
  ok(
    "concurrent claims consume a token exactly once",
    race.filter((r) => r.status === "fulfilled").length === 1,
  );
  for (let i = 0; i < 20; i++) {
    try {
      await invite(A);
    } catch {
      break;
    }
  }
  await denied(
    "creator rate limit is enforced",
    A,
    "select public.create_invite()",
  );
  await asUser(A, "select public.delete_my_account()");
  ok(
    "account deletion removes profile, contacts, and auth identity",
    (await admin.query("select * from auth.users where id=$1", [A]))
      .rowCount === 0 &&
      (
        await admin.query(
          "select * from public.contact_methods where owner_id=$1",
          [A],
        )
      ).rowCount === 0,
  );
  const tables = await admin.query(
    "select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'",
  );
  ok(
    "RLS is enabled on every application table",
    tables.rows.every((t) => t.relrowsecurity),
  );
  console.log(
    `\n${passed} PostgreSQL security/lifecycle checks passed. Auth fixture used; hosted Supabase and phone testing remain separate.`,
  );
} catch (e) {
  console.error("Database tests failed:", e.message);
  process.exitCode = 1;
} finally {
  await admin?.end();
  if (started) docker("stop", name);
}
