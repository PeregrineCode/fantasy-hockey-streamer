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

## Prerequisites

- **Node.js 18+** (uses native `fetch`)
- A **Yahoo Developer app** with Fantasy Sports (Read) permissions

## Install

### npx (no install needed)

```bash
npx fantasy-hockey-streamer
```

### Global install

```bash
npm install -g fantasy-hockey-streamer
```

### From source

```bash
git clone https://github.com/your-username/fantasy-hockey-streamer.git
cd fantasy-hockey-streamer
npm install
npm link   # makes 'stream' available globally
```

## Setup (~2 minutes)

On first run, the setup wizard walks you through everything:

```bash
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

# Specific league
stream 465.l.26962

# Next week
stream --next

# Specific fantasy week
stream --week 21

# Week containing a date
stream --date 2026-03-23

# Already used 2 adds this week
stream --adds-used 2

# Include goalie streaming slots
stream --goalies

# Simulate adding a player
stream --add "Schneider"

# Simulate adding a player starting Tuesday
stream --add "Schneider:Tue"

# Combine flags
stream --next --add "Schneider:Tue" --add "Benoit" --goalies
```

### Subcommands

```bash
stream setup      # Re-run the setup wizard
stream auth       # Re-authenticate with Yahoo
stream leagues    # List your NHL fantasy leagues
stream status     # Show config, token expiry, default league
stream help       # Usage information
```

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
3. Simulates daily roster slot assignments using a greedy algorithm (most constrained positions first)
4. Fetches top free agents by position, enriched with last-30-day stats
5. Scores each free agent based on: empty slot fills, off-night coverage, schedule density, and player quality
6. Builds multi-wave streaming plans that maximize total games gained
7. For H2H Categories leagues: adjusts streamer weights based on which categories you're currently losing

## License

MIT
