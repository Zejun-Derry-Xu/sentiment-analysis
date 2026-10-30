# Trusted HTTPS deployment

Canonical URL: **https://sentiment-analysis.cis240466.projects.jetstream-cloud.org/**.

Caddy 2.10.2 is the additional cloud TLS edge, pinned to digest `sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d`. Let's Encrypt issued the hostname certificate; automatic renewal state and private keys persist in named volumes, outside Git. Existing models and PostgreSQL are unchanged.

Browser traffic: HTTPS :443 → Caddy → private Docker Web :80 → API. Plain HTTP (including the VM IP) redirects to the canonical HTTPS hostname. Web's host port is loopback-only :5180. Database, model and Caddy admin ports are not published. HTTP/1.1 and HTTP/2 are enabled; TLS verified as TLS 1.3. HSTS is configured for the single hostname (`max-age=31536000`, no subdomain policy).

The private environment sets the HTTPS origin and `COOKIE_SECURE=true`. Sessions are Secure + HttpOnly + SameSite=Lax. Unit-test service configuration explicitly uses HTTP test cookies only inside the dedicated test application/database; this does not change production cookie settings.

Verification used system default certificate trust without insecure flags: valid hostname/chain, HTTP redirect, HSTS, Secure cookie attributes, session lookup, an actual English post completing both models, rejected untrusted Origin, and the original 12,284-sample sentiment report. See [record](results/https/verification.json).

Configuration backup: `/home/exouser/sentiment-analysis-backups/pre-https.env` (private, outside Git). Certificates, passwords and private environment values are not included in this repository.

For future unshelve operations verify DNS points to the instance's new IP; preserve the hostname and TLS volumes. Automatic renewal requires the VM and its ports/network to be available. HTTPS encrypts transport; the previously agreed public-demo admin access mode is unchanged.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [official Docker operation](https://caddyserver.com/docs/running#docker-compose).
