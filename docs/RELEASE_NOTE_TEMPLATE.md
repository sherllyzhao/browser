# Release Note Template

## Basic Info

- Version: `vX.Y.Z`
- Date: `YYYY-MM-DD`
- Type: `feature / fix / refactor / hotfix`
- Scope: `all users / gray users / internal`

## Summary

- Added:
- Changed:
- Fixed:

## Details

### 1) Cookie & Session

- Cookie persistence includes `expirationDate` (Unix seconds).
- Session restore keeps original expiration when available.
- If expiration is missing, fallback policy applies (default +1 year).

### 2) Auth Validity Rules

- Login validity is decided by:
- Cookie state
- `globalStorage.login_expires`
- Backend auth result (e.g. `401`)
- Note: changing local cookie expiry cannot guarantee permanent login.

### 3) User Prompts

- Expired prompt: show message and redirect to login.
- Pre-expiry prompt: warn before expiration (default 10 minutes).
- Config key: `TOKEN_EXPIRY_REMINDER_SECONDS` in `renderer.js`.

## Impact & Risk

- Impacted modules:
- Potential risks:
- Rollback plan:

## Verification Checklist

- [ ] Restart app and login state restores correctly
- [ ] Pre-expiry warning appears
- [ ] Expired flow shows message and redirects
- [ ] Third-party publish window relogin flow is clear
- [ ] No regression in multi-account publish flow

## References

- PR:
- Issue:
- Owner:

