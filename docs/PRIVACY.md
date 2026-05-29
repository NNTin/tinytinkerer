# Privacy & Telemetry

TinyTinkerer collects limited, optional diagnostic data ("telemetry") to improve the
stability, performance, and security of the application. Telemetry is off by default and
only starts after you explicitly enable it.

## What we collect

When telemetry is enabled, we collect:

- Crash and error reports (error messages and stack traces).
- The application version and build hash.
- A random installation ID (a UUID generated on this device).
- When you are signed in, your GitHub account identifier (id/login).
- Your IP address, which is automatically observed by our error-monitoring
  provider (Sentry) and our edge infrastructure (Cloudflare) when reports and
  requests are received. We do not use it to track you across sites.

## What we do NOT collect

- The content of your conversations, prompts, or responses.
- Your GitHub access token or any credentials.

## Why we collect it

To detect, reproduce, and fix crashes and errors, and to improve reliability and security.

## Anonymous or linked?

Telemetry is pseudonymous by default: events are associated with a random installation ID,
not your identity. When you are signed in and telemetry is enabled, reports may be linked to
your GitHub account so we can follow up on issues.

## Where it is sent

- Crash and error reports are sent to Sentry (our error-monitoring provider).
- The application version, build hash, installation ID, and (when signed in) GitHub identifier
  are sent as request headers (X-App-Version, X-Build-Hash, X-Install-ID, X-GitHub-ID) to the
  TinyTinkerer edge API. X-App-Version and X-Build-Hash are always sent as non-identifying
  operational metadata; X-Install-ID and X-GitHub-ID are only sent once telemetry has been
  enabled.

## How long we keep it

Diagnostic data is retained only as long as needed to investigate and fix issues,
subject to our error-monitoring provider's default retention period (Sentry retains
events for up to 90 days).

## Your control

Telemetry is opt-in and off by default. You can enable or disable it at any time in
Settings → Privacy → Telemetry. Disabling it stops further reports immediately.

To request access to, or deletion of, diagnostic data associated with your
installation ID or GitHub account, contact the data controller (Tin Nguyen) at:
https://www.linkedin.com/in/tin-nguyen-019299279/
