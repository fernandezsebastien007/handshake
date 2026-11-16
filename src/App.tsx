import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Auth, Recovery, type Act } from "./Auth";
import { Directory, ConnectionDetail } from "./Directory";
import { ContactSettings, DeleteAccount, ProfileForm } from "./Profile";
import { Exchange, PendingRequests, ReviewHandshake } from "./Exchange";
import {
  configured,
  emptySnapshot,
  failIf,
  friendlyError,
  loadSnapshot,
  routeToken,
  supabase,
  type Snapshot,
} from "./lib";

function InstallHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="install-help">
      <button className="text-button" onClick={() => setOpen(!open)}>
        Install on your phone ↗
      </button>
      {open && (
        <div className="card">
          <strong>Keep your connections close</strong>
          <p>
            iPhone: open in Safari, tap Share, then Add to Home Screen. Android:
            open in Chrome, use the browser menu and choose Install app or Add
            to Home screen.
          </p>
          <p>
            Installation and camera access need HTTPS (or localhost during
            development). When offline, the app opens a safe fallback; account
            data needs a connection.
          </p>
        </div>
      )}
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [hash, setHash] = useState(location.hash);
  const [recovery, setRecovery] = useState(false);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const sessionId = useRef<string | undefined>(undefined);
  const token = routeToken(hash);
  const userId = session?.user.id;
  const myProfile = data.profiles.find((p) => p.id === userId);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const onHash = () => setHash(location.hash);
    const onOnline = () => setOnline(navigator.onLine);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const accept = (s: Session | null) => {
      if (!alive) return;
      if (sessionId.current !== s?.user.id) {
        generation.current++;
        sessionId.current = s?.user.id;
        setData(emptySnapshot);
        setLoaded(false);
        setLoadError(false);
        setError("");
        setMessage("");
      }
      setSession(s);
      setAuthReady(true);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      accept(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    supabase.auth.getSession().then(({ data: d, error: e }) => {
      if (e && alive) setError(friendlyError(e));
      accept(d.session);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!sessionId.current || !navigator.onLine) return;
    const current = generation.current;
    const sequence = ++refreshSequence.current;
    try {
      const next = await loadSnapshot();
      if (
        current !== generation.current ||
        sequence !== refreshSequence.current
      )
        return;
      setData(next);
      setLoaded(true);
      setLoadError(false);
    } catch (e) {
      if (
        current === generation.current &&
        sequence === refreshSequence.current
      ) {
        setData(emptySnapshot);
        setLoadError(true);
        setError(friendlyError(e));
      }
      throw e;
    }
  }, []);
  useEffect(() => {
    if (!userId || !online) {
      generation.current++;
      setData(emptySnapshot);
      setLoaded(false);
      return;
    }
    const update = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    };
    update();
    const timer = setInterval(update, 15000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      generation.current++;
    };
  }, [userId, online, refresh]);
  const act: Act = async (task) => {
    if (busyRef.current) return;
    if (!navigator.onLine) {
      setError("You’re offline. Reconnect to continue.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      setMessage((previous) => previous || "Done. Your changes are saved.");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  let content;
  if (!online)
    content = (
      <section className="card narrow">
        <span className="eyebrow">OFFLINE</span>
        <h1>A moment to reconnect.</h1>
        <p>
          Your account, Handshakes, and contact details need an internet
          connection. We don’t save private directory data for offline browsing.
        </p>
        <button onClick={() => location.reload()}>Try again</button>
      </section>
    );
  else if (!configured)
    content = (
      <section className="card narrow">
        <span className="eyebrow">LOCAL PROTOTYPE</span>
        <h1>Ready to connect.</h1>
        <p>
          The app needs a Supabase project before you can create an account.
          Follow README.md to apply the migration and add the project URL and
          public key to your local .env file.
        </p>
        <p>No account data is simulated in this screen.</p>
      </section>
    );
  else if (!authReady)
    content = <p role="status">Opening your private space…</p>;
  else if (!session)
    content = (
      <>
        {token && (
          <p className="banner">
            You’ve received a Handshake. Sign in or create an account to review
            it. If email confirmation opens a new tab, reopen the original link
            afterward.
          </p>
        )}
        <Auth act={act} notify={setMessage} />
      </>
    );
  else if (recovery)
    content = <Recovery act={act} done={() => setRecovery(false)} />;
  else if (loadError)
    content = (
      <section className="card narrow">
        <h1>We couldn’t load your private space.</h1>
        <p>
          Check your connection and confirm that the database migration has been
          applied.
        </p>
        <button onClick={() => void act(refresh)}>Try again</button>
      </section>
    );
  else if (!loaded) content = <p role="status">Loading your connections…</p>;
  else if (!myProfile)
    content = (
      <div className="narrow">
        <ProfileForm userId={session.user.id} act={act} refresh={refresh} />
      </div>
    );
  else if (token)
    content = (
      <ReviewHandshake key={token} token={token} act={act} refresh={refresh} />
    );
  else if (hash === "#/exchange")
    content = (
      <Exchange
        act={act}
        requests={data.pending}
        refresh={refresh}
        notify={setMessage}
      />
    );
  else if (hash === "#/profile")
    content = (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">ON YOUR TERMS</span>
            <h1>Profile & privacy</h1>
            <p>You decide what stays private and what gets shared.</p>
          </div>
        </div>
        <div className="two-columns">
          <ProfileForm
            key={myProfile.id}
            profile={myProfile}
            userId={session.user.id}
            act={act}
            refresh={refresh}
          />
          <div>
            <ContactSettings
              contacts={data.contacts.filter((c) => c.owner_id === userId)}
              userId={session.user.id}
              act={act}
              refresh={refresh}
            />
            <DeleteAccount act={act} />
          </div>
        </div>
      </>
    );
  else if (hash.startsWith("#/connection/")) {
    const connection = data.connections.find(
      (c) => c.id === hash.slice("#/connection/".length),
    );
    content = connection ? (
      <ConnectionDetail
        key={connection.id}
        data={data}
        connection={connection}
        userId={session.user.id}
        act={act}
        refresh={refresh}
      />
    ) : (
      <section className="card">
        <h1>Connection unavailable</h1>
        <a href="#/directory">Back to your connections</a>
      </section>
    );
  } else
    content = (
      <>
        <Directory data={data} userId={session.user.id} />
        {data.pending.length > 0 && (
          <PendingRequests
            requests={data.pending}
            act={act}
            refresh={refresh}
          />
        )}
      </>
    );

  return (
    <>
      <header className="app-header">
        <a className="brand" href="#/directory">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <span>
            Handshake<span className="version">PROTOTYPE</span>
          </span>
        </a>
        <div className="header-actions">
          <span className="private-badge">◈ Private by default</span>
          {session && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  failIf((await supabase!.auth.signOut()).error);
                  location.hash = "";
                  setRecovery(false);
                })
              }
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      {session && myProfile && online && (
        <nav className="navigation" aria-label="Main navigation">
          <a
            href="#/directory"
            aria-current={
              !hash ||
              hash === "#/directory" ||
              hash.startsWith("#/connection/")
                ? "page"
                : undefined
            }
          >
            ◎ Connections
          </a>
          <a
            href="#/exchange"
            aria-current={hash === "#/exchange" || token ? "page" : undefined}
          >
            ▦ Handshake
            {data.pending.length > 0 && (
              <span className="nav-count">{data.pending.length}</span>
            )}
          </a>
          <a
            href="#/profile"
            aria-current={hash === "#/profile" ? "page" : undefined}
          >
            ◈ Profile & privacy
          </a>
        </nav>
      )}
      <main>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {busy && (
          <p className="busy" role="status">
            Working…
          </p>
        )}
        {needRefresh && (
          <div className="banner">
            An app update is ready. Save any edits first.{" "}
            <button
              className="text-button"
              onClick={() => void updateServiceWorker(true)}
            >
              Update app
            </button>
          </div>
        )}
        <fieldset className="app-fieldset" disabled={busy} aria-busy={busy}>
          {content}
        </fieldset>
        <InstallHelp />
      </main>
      <footer>
        Real connections. A little more intentional.
        <span>Handshake v0.1 · Private networking</span>
      </footer>
    </>
  );
}
