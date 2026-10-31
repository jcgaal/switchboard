# Security policy

Switchboard handles live phone calls, transcripts and API keys. Please report security problems privately, not in public issues.

## Reporting a vulnerability

Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include the affected version or commit, the steps to reproduce, and the impact you expect.

You should receive an acknowledgement within five working days. Fixes are released as soon as they are ready, and reporters are credited unless they ask not to be.

## Supported versions

Only the latest commit on `main` receives security fixes.

## Scope

In scope:

- Bypassing Twilio signature validation on `/voice` or `/ws`
- Reading the dashboard, `/events` or `/api/status` without `OBSERVER_TOKEN`
- Changing voices without `CONTROL_TOKEN`
- Exposure of caller numbers while masking is on
- Exposure of API keys or tokens through events, logs or responses

Out of scope:

- Deployments running with `SKIP_TWILIO_SIGNATURE=true`, `OBSERVER_PUBLIC=true` or `PUBLIC_VOICE_PICKER=true`, which disable those protections by design
- Model behavior, such as prompt injection by a caller, unless it leads to one of the issues above
- Vulnerabilities in Twilio or model providers themselves

## Running it safely

- Keep `OBSERVER_TOKEN` and `CONTROL_TOKEN` long and random.
- Never set `SKIP_TWILIO_SIGNATURE=true` outside local testing. The server refuses it when `NODE_ENV=production`.
- Leave `MAX_CONCURRENT_CALLS` set, so a public number cannot run up unlimited model and Twilio charges.
- Keep private agents outside the repository with `AGENTS_DIR`.
