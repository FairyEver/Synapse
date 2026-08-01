# Signup Invitation Flow Design

> Retired on 2026-07-31. Team invitations and their public links were removed from the product and database; this document is retained only as a historical decision record.
>
> Superseded on 2026-05-25 by `docs/superpowers/specs/2026-05-25-personal-module-permissions-design.md`.
> Normal user registration is now open registration. User signup invitations are no longer part of the product flow.

Date: 2026-05-22
Scope: `/Users/liyang/Documents/code/github/Synapse/server`

## Goal

Complete the user signup invitation flow while keeping team invitations separate.

The implementation should support:

- Administrator-created user signup links that open in the existing dashboard frontend bundle.
- Public signup at `/dashboard/signup?invite=<token>` without requiring an administrator session.
- Registration through the existing normal-user auth API.
- A successful terminal state that shows registration success and a link to login.
- Removal of all historical `user_signup` invitation rows because old links are not usable.

Team join invitation pages are out of scope for this change.

## Decisions

- User signup invitation links use `/dashboard/signup?invite=<token>`.
- Old `/invite#token=<token>` links are not supported.
- Existing `user_signup` invitation rows are deleted by migration.
- `user_signup` and `team_join` URL construction are split so future team invitation work does not reuse the signup route.
- The signup page does not save returned user tokens in the browser.
- After successful registration, the page shows success and a "go to login" action.

## User Flow

1. An administrator opens the dashboard invitation or user page.
2. The administrator clicks "创建用户邀请".
3. The server creates a `user_signup` invitation and returns the plaintext token once.
4. The dashboard shows and copies a URL shaped like:

   ```text
   https://host/dashboard/signup?invite=plain-token
   ```

5. The invited user opens the URL.
6. The dashboard frontend renders the public signup page before administrator session routing.
7. The signup page reads the `invite` query parameter.
8. The user enters email and password.
9. The page submits:

   ```http
   POST /api/auth/register
   ```

   with `invitationToken`, `email`, and `password`.

10. The server creates the user and consumes the invitation in one transaction.
11. The page shows "注册成功" and a "去登录" action.

## Backend Design

### Invitation URL Helpers

Replace the generic invitation URL builder with explicit helpers:

- `buildSignupInviteUrl({ publicAppUrl, token })`
- `buildTeamInviteUrl({ publicAppUrl, token })`

`buildSignupInviteUrl` returns:

```text
<publicAppUrl>/dashboard/signup?invite=<encoded token>
```

`buildTeamInviteUrl` remains separate. This change does not define a public team invitation page.

`parseInviteTokenInput` should parse:

- bare plaintext tokens
- full URLs with `invite`
- full URLs with `token`
- full URLs with `invitationToken`

The parser may keep this compatibility for API robustness, but newly generated signup links must use only `invite`.

### Invitation Service

`createSignupInvitation` uses `buildSignupInviteUrl`.

`createTeamInvitation` uses `buildTeamInviteUrl`, not the signup helper.

Invitation consumption keeps the current behavior:

- Only unused invitations can be consumed.
- Expired invitations are rejected.
- Consumption and user creation happen in one transaction for registration.

### Database Migration

Add a Prisma migration that deletes all existing user signup invitations:

```sql
DELETE FROM "Invitation" WHERE "type" = 'user_signup';
```

This intentionally removes both used and unused signup invitation rows. It does not delete users, teams, memberships, sessions, or audit logs.

## Frontend Design

### Routing

The dashboard app recognizes `/dashboard/signup?invite=<token>` as a public route.

This check runs before administrator session loading. Opening the signup URL must not redirect to the admin login page and must not require a valid admin cookie.

Existing hash routes remain unchanged for authenticated administrator pages.

### Signup Page

Create a page such as `server/admin/src/pages/signup-page.tsx`.

The page includes only the necessary UI:

- email input
- password input
- submit button
- brief missing-invite state
- brief error state
- success state with a "去登录" action

The page uses existing shadcn components and token classes. It does not add custom colors, inline styles, decorative gradients, or marketing copy.

### API Client

Keep administrator API methods under `adminApi`.

Add a separate normal-user auth API boundary, for example:

```ts
export const userAuthApi = {
  register: (...)
}
```

This prevents public user registration calls from blending into the administrator API surface.

## Error Handling

- Missing `invite` shows a short invalid-link state.
- Register API validation errors are shown as returned by the existing request error normalization.
- Clipboard copy failure keeps the generated invitation link visible and shows the existing copy error.
- Registration success does not depend on storing access or refresh tokens.

## Tests

Backend tests:

- URL helper builds `/dashboard/signup?invite=<token>`.
- Signup invitation creation returns the new URL shape.
- Team invitation creation does not use the signup URL helper.
- Token parsing accepts the new `invite` parameter.

Frontend tests:

- Creating a user invitation displays and copies `/dashboard/signup?invite=<token>`.
- Signup route renders without requiring administrator session.
- Missing invite renders the invalid-link state.
- Successful registration shows the success state and login action.
- Registration failure shows the error state.

Migration review:

- Verify the migration only deletes `Invitation` rows where `type = 'user_signup'`.

## Acceptance Criteria

- New user signup invitation links use `/dashboard/signup?invite=<token>`.
- Opening a signup invitation displays the public signup form.
- Submitting a valid invitation registers a user and consumes the invitation.
- Registration success shows "注册成功" and a "去登录" action.
- Old `/invite#token=<token>` links are not generated.
- All historical `user_signup` invitation rows are deleted by migration.
- Team join invitations remain separate and do not route through signup.
