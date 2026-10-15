# Security policy

Tidepush delivers code to mobile apps, so a security bug can mean arbitrary code running on
users' phones. Please report vulnerabilities privately.

- **Report:** use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability").
  Don't open a public issue.
- **Include:** what's affected, how to reproduce it, and what impact you expect.
- **Response:** we aim to acknowledge reports within 3 working days.

## Supported versions

Only the latest release on `main` gets security fixes.

## Operator checklist

- The code-signing private key belongs only in the Worker secret and a password manager. If it leaks,
  rotate it, which needs a new app build with the new certificate.
- Keep `SETUP_TOKEN` secret until the first owner account exists.
- Revoke API tokens you no longer use (Dashboard → Settings → API tokens).
