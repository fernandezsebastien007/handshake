import { useState } from "react";
import type { Act } from "./Auth";
import {
  type Contact,
  type Profile as UserProfile,
  failIf,
  rpc,
  supabase,
} from "./lib";

export function ProfileForm({
  profile,
  userId,
  act,
  refresh,
}: {
  profile?: UserProfile;
  userId: string;
  act: Act;
  refresh: () => Promise<void>;
}) {
  const [username, setUsername] = useState(profile?.username ?? "");
  const [name, setName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? "");
  return (
    <section className="card">
      <h2>{profile ? "Your profile" : "Make yourself recognizable"}</h2>
      <p>
        Your name and username confirm Handshake requests. Your description and
        picture are visible to accepted connections only.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const values = {
              username: username.toLowerCase().trim(),
              display_name: name.trim(),
              bio: bio.trim(),
              avatar_url: avatar.trim(),
            };
            const result = profile
              ? await supabase!.from("profiles").update(values).eq("id", userId)
              : await supabase!
                  .from("profiles")
                  .insert({ id: userId, ...values });
            failIf(result.error);
            await refresh();
          });
        }}
      >
        <label>
          Username
          <input
            value={username}
            autoCapitalize="none"
            autoComplete="username"
            pattern="[a-z0-9_]{3,24}"
            minLength={3}
            maxLength={24}
            required
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
          />
          <small>
            3–24 lowercase letters, numbers, or underscores. No public search.
          </small>
        </label>
        <label>
          Display name
          <input
            value={name}
            autoComplete="nickname"
            required
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          About you <span className="optional">optional</span>
          <textarea
            value={bio}
            maxLength={500}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>
        <label>
          Picture URL <span className="optional">optional</span>
          <input
            type="url"
            pattern="https://.*"
            maxLength={2048}
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://…"
          />
          <small>
            Use a hosted HTTPS image. Its host receives viewers’ image requests.
          </small>
        </label>
        <button>Save profile</button>
      </form>
    </section>
  );
}

export function ContactSettings({
  contacts,
  userId,
  act,
  refresh,
}: {
  contacts: Contact[];
  userId: string;
  act: Act;
  refresh: () => Promise<void>;
}) {
  const [kind, setKind] = useState<Contact["kind"]>("email");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [sharing, setSharing] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>Contact methods</h2>
      <p>
        Private unless you choose to share. Defaults apply to all accepted
        connections, including future ones. Individual overrides take priority.
      </p>
      <ul className="plain-list">
        {contacts.map((c) => (
          <li key={c.id} className="contact-setting">
            <strong>{c.label}</strong>
            <span className="break">{c.value}</span>
            <label className="check">
              <input
                type="checkbox"
                checked={c.share_default}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void act(async () => {
                    failIf(
                      (
                        await supabase!
                          .from("contact_methods")
                          .update({ share_default: checked })
                          .eq("id", c.id)
                      ).error,
                    );
                    await refresh();
                  });
                }}
              />
              Share with connections by default
            </label>
            {removeId === c.id ? (
              <div className="button-row">
                <button
                  className="danger"
                  onClick={() =>
                    void act(async () => {
                      failIf(
                        (
                          await supabase!
                            .from("contact_methods")
                            .delete()
                            .eq("id", c.id)
                        ).error,
                      );
                      setRemoveId(null);
                      await refresh();
                    })
                  }
                >
                  Confirm deletion
                </button>
                <button className="secondary" onClick={() => setRemoveId(null)}>
                  Keep method
                </button>
              </div>
            ) : (
              <button
                className="text-button danger-text"
                onClick={() => setRemoveId(c.id)}
              >
                Delete method
              </button>
            )}
          </li>
        ))}
      </ul>
      <h3>Add a contact method</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            failIf(
              (
                await supabase!
                  .from("contact_methods")
                  .insert({
                    owner_id: userId,
                    kind,
                    label: label.trim(),
                    value: value.trim(),
                    share_default: sharing,
                  })
              ).error,
            );
            setLabel("");
            setValue("");
            setSharing(false);
            await refresh();
          });
        }}
      >
        <label>
          Type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Contact["kind"]);
              setValue("");
            }}
          >
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="link">External profile link</option>
          </select>
        </label>
        <label>
          Label
          <input
            required
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Personal email, work profile…"
          />
        </label>
        <label>
          {kind === "link"
            ? "HTTPS URL"
            : kind === "phone"
              ? "Phone number"
              : "Email address"}
          <input
            required
            type={kind === "email" ? "email" : kind === "phone" ? "tel" : "url"}
            pattern={
              kind === "link"
                ? "https://.*"
                : kind === "phone"
                  ? "\\+?[0-9 ()-]{3,40}"
                  : undefined
            }
            maxLength={500}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={sharing}
            onChange={(e) => setSharing(e.target.checked)}
          />
          Share with all connections by default
        </label>
        <button>Add contact method</button>
      </form>
      <p className="fineprint">
        Revocation blocks future reads. Information someone already copied
        cannot be recalled.
      </p>
    </section>
  );
}

export function DeleteAccount({ act }: { act: Act }) {
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <h2>Account & data</h2>
      <p>
        Deleting your account removes your profile, connections, requests,
        contact methods, and private notes. Copies held by other people cannot
        be recalled.
      </p>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await rpc("delete_my_account");
              await supabase!.auth.signOut({ scope: "local" });
              location.hash = "";
            });
          }}
        >
          <label>
            Type DELETE to permanently delete your account
            <input
              required
              pattern="DELETE"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="danger" disabled={confirm !== "DELETE"}>
            Permanently delete account
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="text-button danger-text"
          onClick={() => setOpen(true)}
        >
          Delete my account
        </button>
      )}
    </section>
  );
}
