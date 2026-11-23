# The saved-password key and the macOS keychain

Saved connection passwords (and SSH tunnel passwords and key passphrases) are stored in the
app database encrypted with AES-256-GCM. The key lives in the OS keychain through
`Bun.secrets`, service `dotaz`. This page covers who can read that key on macOS and how
Dotaz moves it when that changes. The code is `src/backend-shared/services/master-key.ts`.

## Who can read a keychain item

`Bun.secrets.set` calls `SecItemAdd` on the login keychain with no access list of its own, so
macOS gives the item the default one: the program that created it may read it without a
prompt, and every other program gets the keychain prompt. macOS recognises "the program"
by its **designated requirement**, a rule taken from its code signature, not by its path.
The access list is fixed when the item is created; `Bun.secrets.set` on an existing item
only updates the value.

The backend of Dotaz is the `bun` binary in `Dotaz.app/Contents/MacOS/bun`. Until releases
are signed with a Developer ID of our own, that binary keeps Bun's signature, whose
requirement is:

```
identifier bun and anchor apple generic and ... and certificate leaf[subject.OU] = "7FRXF46ZSN"
```

Every official `bun` binary (Homebrew, `~/.bun/bin/bun`, the one inside any other
Electrobun app) meets that rule. So any process that can run `bun` reads Dotaz's key without
a prompt, and with the app database it can decrypt every saved password. The key item from
these versions is `dotaz` / `app-encryption-key-v1`.

## What Dotaz does now

At start the backend reads its own designated requirement (`codesign -d -r-` on
`process.execPath`) and keeps the key in an item named after it:
`app-encryption-key-v2-<first 16 hex of sha256(requirement)>`. A new item gets a new
access list, so it is readable without a prompt only by programs that meet the
requirement of the program that created it.

Bun's own requirement (team `7FRXF46ZSN`: unsigned releases, dev builds) keeps the v1 item.
Binding to it would gain nothing, so an unsigned build moves nothing, and the one move
happens with the first release signed with our own Developer ID.

The app database records which item holds its key (setting `keychain.masterKeyItem`; absent
means the v1 item). When the item for the running program differs from the recorded one:

1. Read or create the item for the running program. A new item gets a fresh random key.
2. Read the recorded item. **This is the one read macOS may ask the user about**, because
   the recorded item belongs to the previous identity.
3. Re-encrypt every saved secret under the new key. Secrets still under the old
   hostname-derived key are re-encrypted too.
4. Record the new item and its key's fingerprint, then delete the old one, unless another
   channel still needs it (below). Steps 3 and 4 up to the deletion are one database
   transaction, so a start that dies part-way leaves the old item recorded and every
   secret as it was before, and the next start repeats the move.

Any program may add an item under a name nobody holds yet, and the new name is
predictable. So in step 1 an item already under the new name is used only when one of
Dotaz's databases vouches for it: this one or another channel's holds a secret its key
decrypts, or records its fingerprint. Anything else could have been planted with a key
another program knows and is deleted and recreated. If that fails, the key stays in the
recorded item. The database also keeps a fingerprint of its key (setting
`keychain.masterKeyCheck`) and refuses a different key found later under the recorded name
(see "Resetting the key"). This defence is best-effort: a program that keeps re-adding the
item can win the moment between Dotaz deleting it and adding its own, and the bigger hole
below (running Dotaz's own `bun`) reads the key anyway.

If step 2 is refused, nothing is recorded or deleted: the saved secrets stay encrypted with
the old key, the connections show without passwords for that session, and the next start
asks again. A password saved in the meantime is encrypted with the new key and survives the
later migration.

Going back to a version from before this change after a signed release moved the key loses
the saved passwords (the connections stay): that version only knows the v1 item, finds it
gone and starts a new key. Re-enter the passwords, or reinstall the newer version, which
still has the key.

If the keychain can't be used at all (Linux without a Secret Service, a locked keychain),
the machine-derived fallback key is used for that session, as before, and the window says
so.

When `codesign` can't answer on macOS (it fails, or times out on a busy start), the
identity is unknown, not changed: Dotaz keeps the recorded item and moves nothing. Off
macOS the item stays `app-encryption-key-v1`: Secret Service and Windows Credential Manager
have no per-program access lists.

### Resetting the key

If the window says "Saved passwords can't be decrypted" (the log: the master key "is not
the one this database was encrypted with"), the item under the recorded name holds a key
Dotaz did not put there. Dotaz refuses it, the saved passwords show empty, and passwords
saved from then on are encrypted with the machine-derived key until the state is reset.
To reset: quit Dotaz, delete the item (service `dotaz`, account named in the notice: on
macOS `security delete-generic-password -s dotaz -a <item>`, on Linux with a Secret Service
tool such as Seahorse, on Windows in Credential Manager), delete the two settings from the
app database
(`DELETE FROM settings WHERE key IN ('keychain.masterKeyItem', 'keychain.masterKeyCheck')`),
start Dotaz and re-enter the passwords.

### Channels

Stable, canary and dev builds keep separate app databases next to each other
(`~/Library/Application Support/<identifier>/<channel folder>/dotaz.db`) but share the
keychain service. A channel that moves off an item first checks the other channels'
databases (opened read-only) and leaves the item in place while any of them still holds a
secret it decrypts or records it as its key. The last channel to move deletes it. A
channel folder that is never started again keeps the old item alive; once every channel
you use has moved, it can be removed by hand:
`security delete-generic-password -s dotaz -a app-encryption-key-v1`.

Signed stable and canary builds share one requirement and therefore one item. Moves take a
lock file next to the channel folders (`master-key.lock`, holding the holder's process ID),
so two channels started at the same moment don't each create that item. The holder may sit
on the keychain prompt for as long as the user takes, so its lock is never taken over while
the process lives: a channel that has waited 30 seconds keeps its recorded item for this
start (`move-deferred`) and moves on a later one. A lock whose process is gone (or belongs
to another user), or that is older than ten minutes, is left over from a crash and is taken
over: process IDs are reused, so an old lock's ID may name an unrelated process. A deferred
start still refuses a key that doesn't match the recorded fingerprint. Dev builds are never signed (Hutch skips signing for them),
so a dev build keeps using the v1 item, which then stays in the keychain.

## Release signing

`electrobun.config.ts` turns on `codesign` when `ELECTROBUN_DEVELOPER_ID` is set, and
`notarize` when notarization credentials are set too. The release workflow sets them only
when the repository has these secrets; without them the macOS build is unsigned, as before:

| Secret                       | Content                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `MACOS_CERTIFICATE_P12`      | Developer ID Application certificate and private key, `.p12`, base64 |
| `MACOS_CERTIFICATE_PASSWORD` | Password of that `.p12`                                              |
| `MACOS_DEVELOPER_ID`         | Identity name, `Developer ID Application: <Name> (<TEAMID>)`         |
| `APPLE_API_KEY_P8`           | App Store Connect API key (`.p8` contents), for notarization         |
| `APPLE_API_KEY_ID`           | Its key ID                                                           |
| `APPLE_API_ISSUER`           | Its issuer ID                                                        |

After the build, the workflow unpacks the real app from the self-extracting wrapper and
fails the release unless its `Contents/MacOS/bun` carries the release team's requirement:
that is the identity the keychain will trust, and Electrobun only logs a failed signature
and carries on.

The first signed release moves every user's key once (one keychain prompt, which names the
program `bun`). Later signed releases keep the same requirement as long as the identity and
the binary's identifier stay the same, so they don't prompt. Changing the signing team or
the identifier of the bundled `bun` moves the key again, with one prompt.

## What this does not cover

- **Running Dotaz's own `bun` with other code.** The trusted program is a general JavaScript
  runtime. A process that runs `Dotaz.app/Contents/MacOS/bun script.js`, or starts the app
  with an environment that makes the runtime load extra code, is recognised as Dotaz and
  reads the key without a prompt. Signing removes the silent read by every other `bun` on the machine
  (what agents and scripts normally use), not this. Closing it needs a backend executable
  that runs only its own code: a compiled single-file backend, launch constraints that only
  let the Dotaz launcher start it, and an environment it does not take from its parent.
  That is a change in how Electrobun starts the backend.
- **Unsigned builds.** Until the secrets above exist, the key stays in the v1 item, readable
  by any `bun` without a prompt, exactly as before.
- **The web server** (`bunx @dotaz/server`, `src/cli/main.ts`) runs on the user's own `bun`
  and keeps its key in `dev.dotaz.server` / `encryption-key`, readable by any `bun`. Public
  binds already require an explicit `DOTAZ_ENCRYPTION_KEY`.
- **The agent CLI** (`dotaz`, `src/cli-agent`) never touches the keychain: it talks to the
  running app over the control endpoint and gets no decrypted credentials back
  (`docs/agent-cli.md`).

## Checking a signed build by hand

Use a Mac with an older Dotaz that has saved connections with passwords.

1. Install the signed build over it and start it. Expect one keychain prompt naming `bun`
   and the `dotaz` item; allow it. Saved connections connect without asking for passwords.
   The log shows `Master key: migrated`.
2. `security find-generic-password -s dotaz -a app-encryption-key-v1` finds nothing, and
   `security find-generic-password -s dotaz` shows an `app-encryption-key-v2-...` item. Note
   whether deleting the old item caused a second prompt.
3. In Keychain Access, the new item's Access Control lists only Dotaz's `bun`.
4. From a terminal, read the new item with a stock `bun`
   (`Bun.secrets.get({ service: 'dotaz', name: 'app-encryption-key-v2-...' })`): macOS
   prompts. Deny it; the call throws.
5. Quit and start Dotaz again: no prompt.
6. With the CLI endpoint on, `dotaz` commands work and never cause a keychain prompt.
7. Refusal: on another old install, click Deny at step 1. Dotaz opens, connections are
   listed without passwords. Start it again, allow, and the passwords are back.
8. Install the next signed release over it: no prompt.
