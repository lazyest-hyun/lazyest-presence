# Lazyest Presence — instructions for installation agents

Read README.md before installation. This repository supports macOS 13.5+ on Apple
Silicon and Intel. Keep source and user-specific runtime files separate.

## Install

1. When the user requests closed-lid operation, run `./bootstrap.sh install --with-lid`.
   For API scheduling only, run `./bootstrap.sh install`; the built-in power module
   can be added later with `./bootstrap.sh lid-setup`. Do not install another app.
2. The installer prepares a private pinned Node and locked Microsoft 365 CLI.
   The optional power module is built from this repository using Apple Swift.
   If Command Line Tools is missing, complete Apple's installation prompt and retry.
   Do not require Homebrew, Python, global npm packages or a separate power product.
3. Reuse the current Microsoft 365 browser/device-code login when available.
   Otherwise let the user complete their own company-account browser login and MFA
   with the default public client and organizations tenant. Never collect credentials.
4. Do not preemptively require a new Entra app, tenant-wide approval or broad scopes.
   Diagnose actual API/login failures and retry the same login once when appropriate.
   Never use app-only credentials, automated admin consent or someone else's tokens.
5. Closed-lid setup installs this repository's narrow root power helper through the
   normal macOS administrator prompt. Explain this OS approval separately from
   Microsoft permissions. Never bypass MDM or macOS authorization restrictions.
6. Run `status` and `lid-status`. Distinguish scheduler installed, API write verified,
   power setting active and physically closed-lid tested. Do not force writes outside
   daily 08:00–21:00 merely to claim verification.

The temporary clone can be removed after installation. Sources needed to rebuild
or remove the power module are installed alongside the private runtime.
Updating with `install --with-lid` also rebuilds/replaces the native helper.

## Safety

- Every day 08:00–21:00, local Mac time; public holidays are not filtered.
- At 21:00 clear only this app's session. Never force the user to Offline.
- On battery <=20%, pause presence renewals. The power helper separately checks
  battery, thermal state, console user, schedule and a maximum three-minute lease.
- Never remove the expiry watchdog or make permanent blanket sleep changes.
- Power settings active does not prove execution with the lid physically closed.
  Verify repeated closed-lid history entries if the user can perform that test.
- Leave screen lock, passwords and security protections intact. This module does
  not add automatic screen locking; advise locking before closing the lid.
- Do not enable competing sleep-prevention tools. An existing global sleep-disable
  setting not owned by this helper is reported, not silently reset.
- Sleeping, logged-out or powered-off Macs cannot maintain the schedule. Do not
  promise automatic waking, support on other OSes or universal managed-device access.
- `stop` and `lid-off` release this module's setting. `uninstall` removes its root
  helper too and therefore may require macOS administrator approval.

## Repository work

- GitHub owner is `lazyest-hyun`; use its dedicated identity and verify before writes.
- Do not change visibility or create releases without explicit authorization.
- Never commit runtime state, generated plists, account identifiers, logs or tokens.
- Do not read/copy raw Microsoft auth caches or enable CLI telemetry/debug output.
- Use source-relative paths and derive user storage from the installing user's home.
- Keep emails, IDs and personal paths out of console output and public files.
- Use en dashes for Markdown time ranges and escape literal tildes outside code.
- Keep README.md and CLAUDE.md entry points consistent.
- Before publishing, run `npm test`, `npm run check:public` and
  `./scripts/build-power.sh --check`. Tests must not write Microsoft state or
  change system power settings. Real integration checks require the user's task authority.
