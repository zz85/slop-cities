# Contributing

PRs welcome. Every entry lives in [`cities.yml`](cities.yml); the lists in the README and the [world map](https://zz85.github.io/slop-cities/map/)'s data are built from it. Don't edit the lists in README.md directly: the build overwrites them.

To add an entry:

1. Add it to `cities.yml`:
   - **A city:** under its region in `cities.regions`, with its `coords` as `[lat, lon]` (the centre of the part of the city the sim covers). Order doesn't matter there: the README lists cities alphabetically.
   - **Another take on a city that's already listed:** add it to that city's `takes`, with a short `tag` to tell it apart, e.g. `tag: sc0Vu` for **Taipei, Taiwan (sc0Vu)**. Takes are listed in the order you give them.
   - **A New York remix** (same Manhattan, new game, platform or engine): under `remixes.entries`.
   - **Anything else in the same vein:** under `other.entries`.

   ```yaml
   - city: Warsaw
     country: Poland
     coords: [52.2297, 21.0122]
     takes:
       - tag: Isometric Warsaw        # only for a second or later take
         play: https://...
         source: https://github.com/...
         tweet: https://x.com/...
         by: "@handle"                # an @handle links to x.com, a bare name to github.com
         desc: One-line description.  # Markdown is fine
         flags: [isometric, own engine]
         pick: true                   # one of the list's highlights
   ```

   Drop any field you don't have; an entry needs at least one of `play`, `source` or `tweet`. Use `by_url` when the author's link is somewhere else.

2. Run the build. It needs Node 18 or later and nothing else:

   ```sh
   node map/build/build.mjs
   ```

   It rewrites the lists in README.md and `map/data/cities.json`, and stops with a message naming the entry and the field if something is missing or wrong. Commit `cities.yml`, README.md and `map/data/cities.json` together. `node map/build/build.mjs --check` changes nothing and says whether the two built files are up to date.

Also:

- **Flags** go in `flags`, and each becomes a filter on the map:
  - Status: `source only` (no live demo yet), `WIP`, `unverified` (you couldn't check it loads).
  - `own engine`: the city isn't built on Slop New York's code, so the map draws no arc to it from New York.
  - `isometric`: isometric pixel-art or painted maps.
  - `githack`: the author hasn't published a demo, so `play` runs the code straight from the repo through raw.githack.com, as `https://raw.githack.com/OWNER/REPO/BRANCH/index.html`. Use it only when the page loads that way (no build step, no server).
  - Any other label, such as `tiny`, shows as a badge on the map's city card.
- **Picks:** `pick: true` on a take marks it as one of the list's highlights. On the map it gets a Pick badge, comes first on its city's card, and shows under the Picks filter. It doesn't change the README line; the Featured table at the top is still chosen by hand.
- **Lineage:** `remix_of: [singapore]` on a city draws an arc to it from another city it adapts, beside the one from New York.
- **Screenshots:** a `screenshot: screenshots/<name>.jpg` on a take shows on its map card. The Featured table at the top of the README is still written by hand.
- Strip tracking params like `?s=20` from tweet links.
- Link only to things that load.
