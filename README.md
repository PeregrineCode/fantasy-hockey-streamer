# Fantasy Hockey Streamer

A CLI tool that analyzes your Yahoo Fantasy Hockey roster, the NHL schedule, and available free agents to recommend the best streaming pickups for maximizing weekly games played.

Supports H2H Categories (including banger leagues with HIT/BLK), H2H Points, multi-wave streaming plans, matchup-aware category targeting, and projected add simulations.

## Features

- **Schedule analysis** — maps your roster to the NHL weekly schedule, identifies empty roster slots and off-nights
- **Smart streamer scoring** — ranks free agents by schedule fit, positional need, and player quality (last 30 days)
- **Banger league support** — separate scoring and banger (HIT/BLK) target lists, dual-threat flagging
- **Category targeting** — boosts streamers who help categories you're losing in your current matchup
- **Multi-wave streaming** — suggests optimal add/drop timing (2-3 waves) to maximize games across the week
- **Projected adds** — simulate "what if I add Player X on Tuesday?" before committing
- **Drop candidates** — identifies lowest-value roster players as drop targets
- **League-agnostic scoring** — auto-detects your league's stat categories and point values

## Prerequisites

- **Node.js 18+** (uses native `fetch`)
- A **Yahoo Developer app** with Fantasy Sports (Read) permissions

## Install

```bash
git clone https://github.com/DennisMcLeod/fantasy-hockey-streamer.git
cd fantasy-hockey-streamer
npm install
```

Optionally, make `stream` available as a global command:

```bash
npm link
```

## Setup (~2 minutes)

On first run, the setup wizard walks you through everything:

```bash
node bin/stream.js
# or if you ran npm link:
stream
```

1. **Create a Yahoo Developer app** at https://developer.yahoo.com/apps/create/
   - Application Type: **Installed Application**
   - Redirect URI: `https://localhost:3000/auth/callback`
   - API Permissions: **Fantasy Sports (Read)**

2. **Enter your Client ID and Secret** when prompted

3. **Authenticate** — the tool opens a browser URL, you log in with Yahoo, and it captures the OAuth token automatically

4. **Select your default league** from the ones it discovers

Configuration is stored in `~/.config/fantasy-hockey-streamer/`.

## Usage

```bash
# Current week, default league
stream

# Switch leagues by alias (auto-generated from league names during setup)
stream work
stream keeper

# Prefix matching works too
stream ke

# Or use the full Yahoo league key
stream 465.l.26962

# Next week
stream --next

# Specific fantasy week
stream --week 21

# Week containing a date
stream --date 2026-03-23

# Include goalie streaming slots
stream --goalies

# Simulate adding a player
stream --add "Schneider"

# Simulate adding a player starting Tuesday
stream --add "Schneider:Tue"

# Skip matchup-based adjustments (pure schedule + quality ranking)
stream --no-matchup

# Manually boost specific categories (2.5x)
stream --boost "HIT,BLK"

# Override auto-detected adds used this week
stream --adds-used 2

# Combine flags
stream --next --add "Schneider:Tue" --add "Benoit" --goalies
```

### Subcommands

```bash
stream setup              # Re-run the setup wizard
stream auth               # Re-authenticate with Yahoo
stream leagues            # List your leagues and aliases
stream leagues --refresh  # Re-fetch leagues from Yahoo and update aliases
stream status             # Show config, token expiry, default league
stream help               # Usage information
```

### League Aliases

During setup, short aliases are auto-generated from your league names (first word, lowercased). If you're in "Work League" and "Keeper League", you get aliases `work` and `keeper`. Aliases are case-insensitive and support prefix matching.

Run `stream leagues` to see your aliases, or `stream leagues --refresh` to re-sync after joining or leaving a league.

## Configuration

Config is stored in `~/.config/fantasy-hockey-streamer/`:

| File | Purpose |
|------|---------|
| `config.json` | Client ID, secret, default league |
| `token.json` | OAuth access & refresh tokens |
| `certs/` | Auto-generated self-signed SSL certs |

### Environment Variables

You can also configure via environment variables (they override config.json):

```bash
export YAHOO_CLIENT_ID=your_client_id
export YAHOO_CLIENT_SECRET=your_client_secret
export YAHOO_LEAGUE_KEY=465.l.26962
```

## Output Sections

| Section | Description |
|---------|-------------|
| **Weekly Overview** | Day-by-day view: NHL games, your active players, empty slots, off-nights |
| **Matchup Status** | Current H2H category scores (winning/losing/tied) |
| **Dual-Threat Streamers** | Players ranking top-15 in both scoring and banger lists |
| **Top Streamers** | Consolidated top-10 by scoring and banger profiles |
| **Streaming Recommendations** | Per-day top-5 free agents that fill your empty slots |
| **Drop Candidates** | Bottom 25% of your roster by quality — potential drop targets |
| **Streaming Plan** | Optimal multi-wave add sequence with day coverage |
| **Remaining Gaps** | Empty slots the plan doesn't fill, with backup targets |

## How It Works

1. Fetches your roster and league settings from Yahoo Fantasy API
2. Pulls the NHL weekly schedule from `api-web.nhle.com`
3. Builds stat weights from your league's settings (point values for points leagues, default weights for categories leagues)
4. Simulates daily roster slot assignments using a greedy algorithm (most constrained positions first)
5. Fetches top free agents by position, enriched with last-30-day stats
6. Scores each free agent based on: empty slot fills, off-night coverage, schedule density, and player quality
7. Builds multi-wave streaming plans that maximize total games gained
8. For H2H Categories leagues: adjusts streamer weights based on which categories you're currently losing

## Tests

```bash
npm test
```

83 tests covering arg parsing, date helpers, league weight extraction, player quality scoring, slot assignment, streamer ranking, and streaming plan generation. Uses Node's built-in test runner (zero dependencies).

## License

MIT
