# Authentication and session boundary

Blackspire authenticates the browser with an operator-supplied admin credential and then issues a
server-side SQLite session. Production disables bearer authentication unless
`ALLOW_BEARER_AUTH=true` is an explicit operator choice. That opt-in does not bypass the same admin
credential check.

Admin login, optional bearer authentication, Telegram webhook secrets, CSRF tokens, and destructive
reset confirmation tokens are compared as fixed-size SHA-256 digests with
`crypto.timingSafeEqual`. Non-string candidates and empty configured credentials fail closed. The
HTTP request/header limits remain responsible for bounding attacker-controlled input before hashing.

`SESSION_TTL_MS` is optional. Its default is 28,800,000 milliseconds (8 hours), and production accepts
only integer values from 60,000 (1 minute) through 86,400,000 (24 hours). Invalid values stop startup
before the API listens. Rotation never extends the original session expiry. Successful login stores
at most 512 User-Agent characters and 64 client-address characters; session and CSRF identifiers are
independent 192-bit random values.

Malformed percent-encoding in a Cookie header is treated as an absent cookie, not a server error;
other well-formed cookies in the same header remain available. Parsed cookies use a null-prototype
map so cookie names cannot interact with object prototypes.

Sessions are durable in the one production SQLite database, can be individually revoked, and support
an atomic revoke-all cutoff. Expired/revoked cleanup is periodic and revoked rows receive a 24-hour
audit/replay grace period. The approved cookies are `HttpOnly` for the session identifier,
`SameSite=Strict` for both session and CSRF cookies, and `Secure` in production.

This boundary does not authorize enabling bearer authentication, Telegram webhook mode, production
routing, external providers, or Gate 4. Credential rotation and production session revocation remain
operator actions.
