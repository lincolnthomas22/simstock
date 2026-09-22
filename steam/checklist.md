# The Steamworks side, in order

Nothing in this file can be done by a tool. It needs a person with a bank
account, a tax identity and a card. What it is for is making sure none of it
is being worked out for the first time while a form is open.

## 1. Before opening the form

Have these decided, because the signup asks and changing them later is
awkward:

| | |
| --- | --- |
| **Legal entity** | Yourself as an individual, or a company. This is who Valve pays and who signs the distribution agreement. Changing it later means a new account. |
| **Developer / publisher name** | What appears on the store page. It does not have to be your legal name, but the legal name is what the paperwork uses. |
| **Bank account** | For payouts. Account number and routing/IBAN/SWIFT. Must be in the name of the entity above. |
| **Tax identity** | US: a W-9 and an SSN or EIN. Outside the US: a W-8BEN (individual) or W-8BEN-E (company), and a foreign TIN. Claiming a treaty rate needs the TIN; without one, withholding is the full rate. |
| **Price** | The web version is free. Free-on-Steam and paid-on-Steam are different store setups and a free app cannot later be made paid. Decide before the store page. |
| **App name** | `SimStock`. Worth a search on Steam and on a trademark register first — see the risk note below. |

The fee is **$100 per app**, recoupable against the first $1,000 the app earns.
It is charged when the app is created, not when the account is opened.

## 2. The account

1. Register at `partner.steamgames.com`.
2. Sign the Steam Distribution Agreement.
3. Complete the identity, bank and tax forms.
4. Wait. **This is the step that takes real time** — bank and tax verification
   is measured in days to weeks, not hours, and nothing below can start until
   it clears. It is the reason to do this first and everything else second.

## 3. Once it clears: create the app

1. Pay the $100 and create the app. You now have an **App ID**.
2. Put it in `desktop/steam_appid.txt` (git-ignored; it is yours, not the
   repository's).
3. `cd desktop && npm install steamworks.js` and run with the Steam client
   open. `steam.js` logs what it decided on start, so a silent failure is not
   possible — see `desktop/README.md`.
4. **Watch one achievement actually unlock.** This path has never executed:
   `steamworks.js` is an optional dependency that is not installed, there is
   no App ID, and no test touches `steam.js`. It is written to fail safe,
   which means its failure mode is silent — achievements simply never fire
   and nothing complains. Until you have seen one land, treat all 39 as
   unproven.

## 4. Builds and depots

One depot per platform. Build locally rather than from a downloaded CI
artifact — GitHub zips artifacts and zips do not carry the executable bit, so
`launch-linux.sh` and the binary itself arrive unexecutable. See the note in
`desktop/README.md`.

Two settings that are easy to get wrong and painful to debug:

- **Linux launch executable: `launch-linux.sh`, not `SimStock`.** Without it
  the game aborts before drawing a window inside Steam's container. This is
  the whole point of that script.
- **Auto-Cloud pattern: `simstock-save.json` — not `*`, not `*.json`.**
  Syncing `simstock-local.mirror` or the `simstock-conflict-*.bak` files would
  sync the very copies that exist to survive a sync.

Each platform depot is about **265 MB**. Only ~1 MB of that is the game; the
rest is the Chromium that Electron ships, which is the trade made in
`desktop/README.md` for the game running the same everywhere.

## 5. Achievements

39 of them, in `desktop/steam-achievements.tsv`, generated from `game.js`. The
Steamworks UI has no bulk import, so they go in by hand, and each needs two
icons — locked and unlocked, 64×64. That is 78 images.

## 6. The content survey

Answer it accurately rather than quickly. The ones that need thought:

- **Gambling.** There is no wagering of real money, no loot box, no purchase
  of in-game currency, and no cash-out. The game simulates a market, which is
  not the same as simulating a casino — but a stock, crypto and memecoin game
  is the sort of thing that draws the question, so be ready to say plainly
  what it does and does not do. The in-game line already says it: *"Company
  and coin names in SimStock are parodies, and every price is simulated. No
  real money is involved."*
- **Real-world brands.** None are used. The companies are parodies —
  `Appel Inc.`, `Koka-Cola Company`, `Macrosoft Corporation`, `Teslo Motors`,
  `Lockheed Martian` and so on.

## 7. Store page

Copy is in `store-page.md`. Valve reviews the page; budget a week of
back-and-forth. Then there is a **mandatory two-week wait** between setting a
release date and releasing, which runs regardless of how ready everything is.

## Two risks worth deciding about deliberately

**The parody names.** Roughly twenty companies are recognisable send-ups of
real ones. Parody is the usual defence and these are clearly transformative
rather than passing themselves off as the real thing — but this is a judgement
call and not a technical one, and a trademark holder can complain after launch
whatever Valve's review says. If that is a risk you would rather not carry,
the names are all in one table at the top of `game.js` and renaming them is a
contained change. Worth deciding on purpose rather than by default.

**Online PvP depends on your server.** The Versus mode goes through the match
server in `server/`, not through Steam's networking. If you claim online PvP
on the store page, that feature is only as available as that server is —
hosting it stops being a hobby the day it is advertised. Steam's own lobbies
would remove the dependency, and are worth considering before launch rather
than after.
