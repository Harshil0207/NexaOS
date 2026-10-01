# ADR-0004: Opaque server-side sessions instead of JWTs

**Status:** accepted · **Date:** 2026-09-26

**Decision.** Random 256-bit session tokens in httpOnly SameSite=Lax cookies; the database stores
only an HMAC of the token. Sessions have absolute and idle expiry and are revocable (logout, password
reset). The web app proxies `/api/v1` so cookies stay first-party; state-changing requests also
require an allowed Origin.

**Consequences.** Instant revocation and no token-in-JS exposure, at the cost of one indexed lookup
per request. API keys for machine clients are a separate mechanism (planned).
