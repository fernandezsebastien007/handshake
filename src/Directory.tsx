import { useState } from "react";
import type { Act } from "./Auth";
import {
  type Profile,
  type Snapshot,
  type Connection,
  contactHref,
  failIf,
  normalizeTags,
  rpc,
  supabase,
} from "./lib";

export function Avatar({ profile }: { profile: Profile }) {
  return profile.avatar_url ? (
    <img
      className="avatar"
      src={profile.avatar_url}
      referrerPolicy="no-referrer"
      alt=""
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  ) : (
    <span className="avatar" aria-hidden="true">
      {profile.display_name.slice(0, 1).toUpperCase()}
    </span>
  );
}
export function Directory({
  data,
  userId,
}: {
  data: Snapshot;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const peers = data.connections.map((c) => ({
    connection: c,
    profile: data.profiles.find(
      (p) => p.id === (c.user_low === userId ? c.user_high : c.user_low),
    ),
    note: data.notes.find((n) => n.connection_id === c.id),
  }));
  const filtered = peers.filter(
    ({ profile: p, note: n }) =>
      p &&
      [p.display_name, p.username, n?.notes, ...(n?.tags ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PRIVATE CIRCLE</span>
          <h1>
            Your connections <span className="count">{peers.length}</span>
          </h1>
          <p>People you’ve met. Connections you choose to keep.</p>
        </div>
        <a className="button" href="#/exchange">
          + New Handshake
        </a>
      </div>
      <label className="search">
        Search your connections
        <input
          type="search"
          placeholder="Search names, private notes, or tags"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {filtered.length ? (
        <div className="directory-grid">
          {filtered.map(
            ({ connection: c, profile: p, note: n }) =>
              p && (
                <a
                  className="card person"
                  key={c.id}
                  href={`#/connection/${c.id}`}
                >
                  <div className="person-heading">
                    <Avatar profile={p} />
                    <div>
                      <h2>{p.display_name}</h2>
                      <span className="muted">@{p.username}</span>
                    </div>
                    <span className="person-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </div>
                  <p className="clamp">
                    {p.bio || "A connection made in real life."}
                  </p>
                  <div className="tags">
                    {n?.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                  <small>
                    Connected{" "}
                    {new Date(c.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </small>
                </a>
              ),
          )}
        </div>
      ) : (
        <section className="empty card">
          <span className="empty-symbol" aria-hidden="true">
            ◎
          </span>
          <h2>
            {query
              ? "No connections match"
              : "Your next connection starts here"}
          </h2>
          <p>
            {query
              ? "Try a different name, note, or tag."
              : "When you meet someone, exchange a Handshake. Once you both approve, you’ll find each other here."}
          </p>
          {!query && (
            <a className="button" href="#/exchange">
              Make a Handshake →
            </a>
          )}
        </section>
      )}
      <p className="privacy-note">
        ◈ Only accepted connections appear here. Your notes and tags stay yours.
      </p>
    </>
  );
}

export function ConnectionDetail({
  data,
  connection,
  userId,
  act,
  refresh,
}: {
  data: Snapshot;
  connection: Connection;
  userId: string;
  act: Act;
  refresh: () => Promise<void>;
}) {
  const peerId =
    connection.user_low === userId ? connection.user_high : connection.user_low;
  const profile = data.profiles.find((p) => p.id === peerId);
  const existing = data.notes.find((n) => n.connection_id === connection.id);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [remove, setRemove] = useState(false);
  if (!profile)
    return (
      <section className="card">
        <p>This connection is no longer available.</p>
        <a href="#/directory">Back to connections</a>
      </section>
    );
  const shared = data.contacts.filter((c) => c.owner_id === peerId);
  return (
    <>
      <a className="back-link" href="#/directory">
        ← All connections
      </a>
      <section className="card">
        <div className="person-heading">
          <Avatar profile={profile} />
          <div>
            <h1>{profile.display_name}</h1>
            <p>@{profile.username}</p>
          </div>
        </div>
        <p className="preserve">{profile.bio}</p>
      </section>
      <div className="two-columns">
        <div>
          <section className="card">
            <h2>Shared with you</h2>
            {shared.length ? (
              <ul className="plain-list">
                {shared.map((c) => (
                  <li key={c.id}>
                    <strong>{c.label}</strong>
                    <a
                      className="contact-link break"
                      href={contactHref(c)}
                      target={c.kind === "link" ? "_blank" : undefined}
                      rel="noopener noreferrer"
                    >
                      {c.value}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No contact details shared yet. Each person chooses what to
                share.
              </p>
            )}
          </section>
          <section className="card">
            <h2>Just for you</h2>
            <p>These notes and tags are visible only to you.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  failIf(
                    (
                      await supabase!
                        .from("connection_notes")
                        .upsert({
                          owner_id: userId,
                          connection_id: connection.id,
                          notes,
                          tags: normalizeTags(tags),
                        })
                    ).error,
                  );
                  await refresh();
                });
              }}
            >
              <label>
                Private notes
                <textarea
                  maxLength={5000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Where you met, what you talked about…"
                />
              </label>
              <label>
                Tags
                <input
                  maxLength={500}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Design, community, conference"
                />
                <small>Separate with commas. Up to 20 tags.</small>
              </label>
              <button>Save notes & tags</button>
            </form>
          </section>
        </div>
        <div>
          <section className="card">
            <h2>What you share</h2>
            <p>
              Choose what {profile.display_name} can read. “Use default” follows
              your contact method’s current setting.
            </p>
            {data.contacts
              .filter((c) => c.owner_id === userId)
              .map((c) => {
                const override = data.overrides.find(
                  (o) => o.contact_id === c.id && o.recipient_id === peerId,
                );
                return (
                  <label key={c.id}>
                    {c.label}
                    <small className="break">{c.value}</small>
                    <select
                      aria-label={`Share ${c.label}`}
                      value={override ? String(override.allowed) : "default"}
                      onChange={(e) => {
                        const value = e.target.value;
                        void act(async () => {
                          const result =
                            value === "default"
                              ? await supabase!
                                  .from("contact_overrides")
                                  .delete()
                                  .eq("contact_id", c.id)
                                  .eq("recipient_id", peerId)
                              : await supabase!
                                  .from("contact_overrides")
                                  .upsert({
                                    contact_id: c.id,
                                    recipient_id: peerId,
                                    allowed: value === "true",
                                  });
                          failIf(result.error);
                          await refresh();
                        });
                      }}
                    >
                      <option value="default">
                        Use default ({c.share_default ? "shared" : "private"})
                      </option>
                      <option value="true">Share with this person</option>
                      <option value="false">
                        Keep private from this person
                      </option>
                    </select>
                  </label>
                );
              })}
            <a href="#/profile">Manage your contact methods →</a>
            <p className="fineprint">
              Changes apply to future reads. Previously copied information
              cannot be recalled.
            </p>
          </section>
          <section className="card">
            <h2>Manage connection</h2>
            <p>
              Removing a connection revokes profile and contact access for both
              people and deletes both sets of private notes.
            </p>
            {remove ? (
              <div className="button-row">
                <button
                  className="danger"
                  onClick={() =>
                    void act(async () => {
                      await rpc("remove_connection", {
                        connection_id: connection.id,
                      });
                      location.hash = "#/directory";
                      await refresh();
                    })
                  }
                >
                  Confirm removal
                </button>
                <button className="secondary" onClick={() => setRemove(false)}>
                  Keep connection
                </button>
              </div>
            ) : (
              <button
                className="text-button danger-text"
                onClick={() => setRemove(true)}
              >
                Remove connection
              </button>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
