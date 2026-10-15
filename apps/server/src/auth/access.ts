import { base64ToBytes } from "../lib/encoding";

/**
 * Cloudflare Access JWT verification (the Cf-Access-Jwt-Assertion header Access
 * adds). Optional, an extra layer on top of Tidepush's own auth: the identity
 * must still map to an active admin (see middleware.ts).
 */
export interface AccessClaims {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
  /** Set instead of email for Access service tokens. */
  common_name?: string;
  sub?: string;
}

type Jwk = JsonWebKey & { kid: string };

// JWKS cache per isolate. Access rotates keys rarely; refetch on unknown kid.
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

export type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const defaultFetcher: JwksFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return res.json();
};

export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string; fetchJwks?: JwksFetcher; now?: number },
): Promise<AccessClaims> {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error("Malformed JWT");
  const decode = (s: string) => JSON.parse(new TextDecoder().decode(base64ToBytes(s)));
  const header = decode(headerB64) as { alg: string; kid: string };
  const claims = decode(payloadB64) as AccessClaims;
  if (header.alg !== "RS256") throw new Error(`Unexpected alg ${header.alg}`);

  const issuer = `https://${opts.teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const jwk = await findKey(`${issuer}/cdn-cgi/access/certs`, header.kid, opts.fetchJwks ?? defaultFetcher);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64ToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error("Bad signature");

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.iss !== issuer) throw new Error("Bad issuer");
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.aud)) throw new Error("Bad audience");
  if (typeof claims.exp !== "number" || claims.exp < now) throw new Error("Expired");
  if (claims.nbf !== undefined && claims.nbf > now + 60) throw new Error("Not yet valid");
  return claims;
}

async function findKey(url: string, kid: string, fetchJwks: JwksFetcher): Promise<Jwk> {
  const cached = jwksCache.get(url);
  const fresh = cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS;
  let key = fresh ? cached.keys.find((k) => k.kid === kid) : undefined;
  if (!key) {
    const { keys } = await fetchJwks(url);
    jwksCache.set(url, { keys, fetchedAt: Date.now() });
    key = keys.find((k) => k.kid === kid);
  }
  if (!key) throw new Error(`Unknown kid ${kid}`);
  return key;
}
