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

### Canonical Currents categories

`general, society, science_technology, politics_government, economy_business_finance,
arts_culture_entertainment, lifestyle_leisure, human_interest, sport,
crime_law_justice, education, environment, labour, health, automotive, real_estate`

## Rate limit math

Free tier = 1,000 requests/day. This module only calls the API on `updateInterval`,
not on `rotateInterval` (rotation just cycles through already-fetched articles
client-side). At the default 30-minute `updateInterval`, that's 48 requests/day —
plenty of headroom.

## Why this exists

newsapi.org's free Developer plan delays articles by 24 hours and technically
forbids production use (even "internal" use on your own mirror). Currents'
free tier doesn't have that delay, which is the whole point of a smart mirror
news widget.

## License

MIT
