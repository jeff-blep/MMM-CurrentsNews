# MMM-CurrentsNews

A MagicMirror² module that displays news headlines using the [Currents API](https://currentsapi.services)
instead of newsapi.org. Built to replace MMM-News, which is stuck on newsapi.org's
free-tier 24-hour article delay and dev-only production ban.

Currents' free tier gives you 1,000 requests/day, real-time articles (no delay),
and no credit card required.

## Installation

1. Get a free API key at https://currentsapi.services/en/register
2. Copy this folder into your MagicMirror `modules` directory:

```bash
cd ~/MagicMirror/modules
# copy the MMM-CurrentsNews folder here
```

No `npm install` needed — the node_helper uses Node's built-in `https` module,
so there are zero dependencies to install or go stale.

3. Add the module to `config/config.js`:

```js
{
    module: "MMM-CurrentsNews",
    position: "bottom_bar",
    config: {
        apiKey: "YOUR_CURRENTS_API_KEY",
        mode: "latest",           // "latest" or "search"
        category: "science_technology",
        country: "",
        language: "en",
        rotateInterval: 1000 * 15,
        updateInterval: 1000 * 60 * 30
    }
}
```

4. Restart MagicMirror.

## Config Options

| Option | Default | Description |
|---|---|---|
| `apiKey` | `""` | **Required.** Your Currents API key. |
| `mode` | `"latest"` | `"latest"` for the real-time news stream, `"search"` for keyword search. |
| `keywords` | `""` | Search terms, only used when `mode: "search"`. |
| `category` | `""` | One of Currents' canonical categories (see below). Empty = all categories. |
| `country` | `""` | 2-letter country code. Empty = all countries. |
| `domains` | `[]` | Array of source domains to keep, e.g. `["cnn.com","reuters.com"]`. Filtered client-side after fetching, since Currents only supports a single `domain` filter server-side. Empty = no filtering. |
| `language` | `"en"` | Article language code. |
| `pageSize` | `20` | Number of articles requested per API call. |
| `maxNewsItems` | `20` | Max number of articles kept in the local rotation. |
| `updateInterval` | `1800000` (30 min) | How often to re-fetch from the Currents API. |
| `rotateInterval` | `15000` (15 sec) | How often the on-screen article rotates. |
| `animationSpeed` | `1000` | Fade transition speed in ms. |
| `showImage` | `true` | Show the article's thumbnail image, if available. |
| `showDescription` | `true` | Show the article description/snippet. |
| `showSourceTitle` | `true` | Show the source domain (derived from the article URL). |
| `showPublishDate` | `true` | Show a relative "x hours ago" timestamp. |
| `truncDescription` | `200` | Max characters shown in the description before truncating. |
| `wrapTitle` | `true` | Wrap long titles instead of clipping them. |
| `layoutMode` | `"big"` | `"big"` (cinematic, large type/image) or `"compact"` (smaller footprint). Matches MMM-MyPlex's naming convention. |
| `cardLayout` | `"auto"` | `"auto"` (image side follows module position - left region shows image on the left, right region shows it on the right), `"left"`, or `"right"`. |

### Canonical Currents categories

`general, society, science_technology, politics_government, economy_business_finance,
arts_culture_entertainment, lifestyle_leisure, human_interest, sport,
crime_law_justice, education, environment, labour, health, automotive, real_estate`

## Recency weighting

Articles are pooled across fetch cycles (deduped, anything older than 24h
is dropped from the pool). Each cycle, the display list is built favoring
freshness: roughly the first half of `maxNewsItems` comes from articles
published in the last 5 hours, the rest from the last 24 hours. If either
window is thin, the module backfills from whatever's available rather than
showing fewer articles than necessary.

## Rate limit math

Free tier = 1,000 requests/day. This module only calls the API on `updateInterval`,
not on `rotateInterval` (rotation just cycles through already-fetched articles
client-side). At the default 30-minute `updateInterval`, that's 48 requests/day —
plenty of headroom.

## Using `domains` to mimic old "sources" filtering

If you're replicating an old MMM-News config that filtered by named sources
(e.g. `cnn, abc-news, reuters`), use `domains` with the actual domains instead:

```js
domains: ["cnn.com", "abcnews.go.com", "reuters.com", "bloomberg.com", "apnews.com"]
```

When `domains` is set, the module fires one request **per domain** (Currents
supports server-side single-domain filtering), then merges and sorts the
results by publish date. This guarantees relevant results instead of hoping
your target outlets happen to show up in a random sample of Currents'
120,000+ total sources.

Rate limit math for this: N domains × (1440 min/day ÷ `updateInterval` in
minutes) requests/day. Five domains at the default 30-minute interval is
240 requests/day — well under the 1,000/day free cap. You could drop
`updateInterval` to 10 minutes (720 requests/day) and still have headroom.

Matched articles also accumulate into a rolling buffer (capped at
`maxNewsItems`) across fetch cycles, so a temporarily thin result doesn't
wipe out articles found in earlier cycles.

## Why this exists

newsapi.org's free Developer plan delays articles by 24 hours and technically
forbids production use (even "internal" use on your own mirror). Currents'
free tier doesn't have that delay, which is the whole point of a smart mirror
news widget.

## License

MIT
