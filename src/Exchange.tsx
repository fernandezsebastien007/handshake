import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Act } from "./Auth";
import {
  type Invite,
  type Pending,
  type Preview,
  handshakeUrl,
  rpc,
  tokenFromInput,
} from "./lib";
import { Scanner } from "./Scanner";

export function PendingRequests({
  requests,
  act,
  refresh,
}: {
  requests: Pending[];
  act: Act;
  refresh: () => Promise<void>;
}) {
  return (
    <section className="card">
      <div className="section-heading">
        <h2>Handshake requests</h2>
        <button className="text-button" onClick={() => void act(refresh)}>
          Refresh
        </button>
      </div>
      {requests.length ? (
        <ul className="plain-list">
          {requests.map((r) => (
            <li key={r.id}>
              <strong>{r.display_name}</strong>
              <span className="muted"> @{r.username}</span>
              <p>
                {r.incoming
                  ? "Wants to connect. Approve only if this is the person you expect."
                  : "Waiting for their approval."}{" "}
                Expires{" "}
                {new Date(r.expires_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                .
              </p>
              <div className="button-row">
                {r.incoming && (
                  <button
                    onClick={() =>
                      void act(async () => {
                        await rpc("respond_handshake", {
                          request_id: r.id,
                          approve: true,
                        });
                        await refresh();
                      })
                    }
                  >
                    Approve Handshake
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() =>
                    void act(async () => {
                      await rpc("respond_handshake", {
                        request_id: r.id,
                        approve: false,
                      });
                      await refresh();
                    })
                  }
                >
                  {r.incoming ? "Decline" : "Cancel request"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No requests waiting. New requests appear here automatically while the
          app is open.
        </p>
      )}
    </section>
  );
}

export function Exchange({
  act,
  requests,
  refresh,
  notify,
}: {
  act: Act;
  requests: Pending[];
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [now, setNow] = useState(Date.now());
  const [scanning, setScanning] = useState(false);
  const [input, setInput] = useState("");
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = invite
    ? Math.max(
        0,
        Math.ceil((new Date(invite.expires_at).getTime() - now) / 1000),
      )
    : 0;
  function open(value: string) {
    const token = tokenFromInput(value);
    if (!token) {
      setScanning(false);
      notify(
        "Use a Handshake link from this app. Other QR codes and websites cannot be opened here.",
      );
      return;
    }
    setScanning(false);
    location.hash = `#/handshake/${token}`;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A SMALL MOMENT. A LASTING CONNECTION.</span>
          <h1>Make a Handshake</h1>
          <p>
            One person shows a code. The other requests. Both choose to connect.
          </p>
        </div>
      </div>
      <div className="two-columns">
        <section className="card qr-card">
          <h2>Your temporary Handshake</h2>
          <p>
            Share this only with the person you want to meet. You’ll confirm
            their request before connecting.
          </p>
          {invite && seconds > 0 ? (
            <>
              <div className="qr-wrap">
                <QRCodeSVG
                  value={handshakeUrl(invite.token)}
                  size={224}
                  level="M"
                  marginSize={3}
                  title="Your temporary Handshake link"
                />
              </div>
              <span className="pill">
                Expires in {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
              <div className="button-row centered">
                <button
                  className="secondary"
                  onClick={() =>
                    void act(async () => {
                      await navigator.clipboard.writeText(
                        handshakeUrl(invite.token),
                      );
                      notify("Handshake link copied.");
                    })
                  }
                >
                  Copy link
                </button>
                {typeof navigator.share === "function" && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void act(async () => {
                        try {
                          await navigator.share({
                            title: "Make a Handshake",
                            url: handshakeUrl(invite.token),
                          });
                        } catch (e) {
                          if ((e as Error).name !== "AbortError") throw e;
                        }
                      })
                    }
                  >
                    Share link
                  </button>
                )}
              </div>
              <label className="link-fallback">
                Or select and copy
                <input
                  aria-label="Your Handshake link"
                  readOnly
                  value={handshakeUrl(invite.token)}
                  onFocus={(e) => e.target.select()}
                />
              </label>
            </>
          ) : (
            <div className="qr-placeholder">
              <span aria-hidden="true">▦</span>
              <p>
                {invite
                  ? "This code has expired."
                  : "Your code will appear here."}
              </p>
            </div>
          )}
          <button
            onClick={() =>
              void act(async () => {
                setInvite(await rpc<Invite>("create_invite"));
                setNow(Date.now());
              })
            }
          >
            {invite ? "Generate a fresh code" : "Generate Handshake code"}
          </button>
          <small>
            Single use · 10 minutes · Generating a new code invalidates the
            previous unused code.
          </small>
        </section>
        <div>
          <section className="card">
            <h2>Have their code?</h2>
            <p>
              Scan it here or use your phone’s camera. A shared link works just
              as well.
            </p>
            <button className="secondary" onClick={() => setScanning(true)}>
              Open QR scanner
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                open(input);
              }}
            >
              <label>
                Or paste a Handshake link
                <input
                  type="url"
                  required
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://…/#/handshake/…"
                  autoComplete="off"
                />
              </label>
              <button>Review Handshake →</button>
            </form>
          </section>
          {scanning && (
            <Scanner onScan={open} onClose={() => setScanning(false)} />
          )}
          <PendingRequests requests={requests} act={act} refresh={refresh} />
        </div>
      </div>
    </>
  );
}

export function ReviewHandshake({
  token,
  act,
  refresh,
}: {
  token: string;
  act: Act;
  refresh: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    setPreview(null);
    setUnavailable(false);
    rpc<Preview>("preview_invite", { raw_token: token })
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        if (alive) setUnavailable(true);
      });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);
  const expired = preview && new Date(preview.expires_at).getTime() <= now;
  return (
    <section className="card narrow review">
      <span className="eyebrow">A NEW CONNECTION</span>
      <h1>Make it mutual.</h1>
      {unavailable || expired ? (
        <>
          <p>
            This Handshake is expired, used, your own, or unavailable. Ask the
            other person for a fresh code.
          </p>
          <a href="#/exchange">Back to Handshakes</a>
        </>
      ) : preview ? (
        <>
          <div className="large-initial" aria-hidden="true">
            {preview.display_name.slice(0, 1)}
          </div>
          <h2>{preview.display_name}</h2>
          <p>@{preview.username}</p>
          <p>
            Is this the person you’re meeting? Request a Handshake. They’ll need
            to approve before your profiles or shared contact methods become
            visible.
          </p>
          <button
            onClick={() =>
              void act(async () => {
                await rpc("claim_invite", { raw_token: token });
                location.hash = "#/exchange";
                await refresh();
              })
            }
          >
            Request Handshake →
          </button>
          <a className="back-link" href="#/exchange">
            Cancel
          </a>
        </>
      ) : (
        <p role="status">Checking Handshake…</p>
      )}
    </section>
  );
}
