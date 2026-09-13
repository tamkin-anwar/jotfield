# Account deployment

The account experience remains hidden when cloud configuration is absent. Local notebooks continue to work without any network request.

## Supabase project

Use a separate Supabase project for each development, preview, and production environment.

1. Apply the migrations in `supabase/migrations` in filename order.
2. Deploy the `delete-account` Edge Function with JWT verification enabled.
3. Set the production site address to `https://tamkin-anwar.github.io/jotfield/`.
4. Add the production address to the authentication redirect allow list.
5. Keep email confirmation enabled.
6. Configure a custom SMTP provider before inviting public users.
7. Require passwords of at least 12 characters and enable leaked-password protection.
8. Review authentication rate limits before launch.

## Browser configuration

Set these values only in the build environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Both values are designed to be visible to browsers. Authorization comes from Row Level Security. Never add the service-role key to a browser variable or GitHub Pages build.

## Account behavior

- New accounts receive a profile and personal workspace in one database transaction.
- Email and password sign-in uses Supabase Auth.
- Magic links and password recovery return to the published Jotfield address.
- Local sign-out ends the current browser session.
- Global sign-out revokes refresh tokens on every device.
- Account deletion runs in an authenticated Edge Function and removes owned cloud workspaces before deleting the Auth user.
- Encrypted sync derives an AES-GCM key in the browser. Supabase stores ciphertext, a random nonce, and a non-secret salt.
- A trusted device keeps its non-extractable sync key in IndexedDB. New devices require the same sync passphrase.
- Jotfield merges notes by their update time before upload and uses the cloud content version to reject stale writes.
- Authenticated Realtime subscriptions deliver encrypted notebook changes to other devices. Offline edits retry automatically after the connection returns.
- Signed-in members can create live links for individual notes. The server stores ciphertext and link controls, while the decryption key stays in the URL fragment.
- Live links expire within 30 days and can be updated or revoked by their owner.
- Browser notes remain local after sign-out or cloud account deletion.

Passkeys require a dedicated WebAuthn server ceremony and recovery design. They should be added after the encrypted device-key batch so authentication and encryption recovery remain separate.
