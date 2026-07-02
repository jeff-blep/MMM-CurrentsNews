/* MMM-CurrentsNews node_helper.js
 * Fetches articles from the Currents API (https://currentsapi.services)
 * and hands them back to the frontend module.
 *
 * Uses Node's built-in https module so there are no extra npm dependencies
 * to install or go stale.
 *
 * When config.domains is set, this fires one request PER domain (Currents
 * supports server-side single-domain filtering) rather than fetching a
 * generic feed and hoping the target outlets show up by chance.
 *
 * Articles are pooled across fetch cycles (deduped, capped at 24h old) and
 * each cycle re-selects a display list favoring recency: roughly half from
 * the last 5 hours, the rest from the last 24 hours, falling back gracefully
 * if either window is thin.
 */

const NodeHelper = require("node_helper");
const https = require("https");

var FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
var TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
var POOL_CAP = 150;

function parsePublishedMs(str) {
	if (!str) {
		return NaN;
	}
	var t = Date.parse(str);
	if (!isNaN(t)) {
		return t;
	}
	// Fallback for "YYYY-MM-DD HH:mm:ss +ZZZZ" shape (space before offset,
	// no colon in offset) which some environments' Date.parse rejects.
	var m = str.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
	if (m) {
		var iso = m[1] + "T" + m[2] + m[3] + ":" + m[4];
		t = Date.parse(iso);
		if (!isNaN(t)) {
			return t;
		}
	}
	return NaN;
}

function hasValidImage(item) {
	var img = item.image;
	if (!img || typeof img !== "string") {
		return false;
	}
	var trimmed = img.trim();
	if (trimmed === "" || trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "null") {
		return false;
	}
	return /^https?:\/\//i.test(trimmed);
}

module.exports = NodeHelper.create({

	start: function () {
		console.log("Starting node_helper for module: " + this.name);
		this.pools = {}; // identifier -> deduped array of articles, capped at 24h old
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "CURRENTSNEWS_FETCH") {
			this.fetchNews(payload.identifier, payload.config);
		}
	},

	fetchNews: function (identifier, config) {
		var self = this;

		if (!config.apiKey) {
			console.error("[MMM-CurrentsNews] No apiKey configured - skipping fetch.");
			return;
		}

		var basePath = config.mode === "search" ? "/v1/search" : "/v1/latest-news";

		function buildParams(domain) {
			var params = [];
			if (config.mode === "search" && config.keywords) {
				params.push("keywords=" + encodeURIComponent(config.keywords));
			}
			if (config.category) {
				params.push("category=" + encodeURIComponent(config.category));
			}
			if (config.country) {
				params.push("country=" + encodeURIComponent(config.country));
			}
			if (config.language) {
				params.push("language=" + encodeURIComponent(config.language));
			}
			if (config.pageSize) {
				params.push("page_size=" + encodeURIComponent(config.pageSize));
			}
			if (domain) {
				params.push("domain=" + encodeURIComponent(domain));
			}
			return params;
		}

		function doRequest(requestPath) {
			return new Promise(function (resolve, reject) {
				var options = {
					hostname: "api.currentsapi.services",
					path: requestPath,
					method: "GET",
					family: 4,
					headers: {
						Authorization: config.apiKey
					}
				};

				console.log("[MMM-CurrentsNews] Fetching: https://api.currentsapi.services" + requestPath);

				var req = https.request(options, function (res) {
					var body = "";
					res.on("data", function (chunk) { body += chunk; });
					res.on("end", function () {
						if (res.statusCode < 200 || res.statusCode >= 300) {
							reject(new Error("API returned status " + res.statusCode + ": " + body));
							return;
						}
						try {
							var data = JSON.parse(body);
							if (data.status !== "ok" || !Array.isArray(data.news)) {
								reject(new Error("Unexpected response shape: " + body.substring(0, 300)));
								return;
							}
							resolve(data.news);
						} catch (err) {
							reject(new Error("Failed to parse response: " + err.message));
						}
					});
				});

				req.on("error", function (err) {
					var details = err.message || "(no message)";
					if (err.code) {
						details += " [code: " + err.code + "]";
					}
					if (Array.isArray(err.errors) && err.errors.length > 0) {
						details += " - nested: " + err.errors.map(function (e) {
							return (e.code || "") + " " + (e.message || "");
						}).join(" | ");
					}
					reject(new Error("Request failed: " + details));
				});

				req.setTimeout(15000, function () {
					req.destroy(new Error("Request timed out after 15s"));
				});

				req.end();
			});
		}

		function normalize(item) {
			var sourceDomain = "";
			try {
				if (item.url) {
					sourceDomain = new URL(item.url).hostname.replace(/^www\./, "");
				}
			} catch (e) {
				sourceDomain = "";
			}
			return {
				id: item.id,
				title: item.title,
				description: item.description,
				url: item.url,
				author: item.author,
				image: item.image,
				language: item.language,
				category: item.category,
				published: item.published,
				sourceDomain: sourceDomain
			};
		}

		var domains = Array.isArray(config.domains) && config.domains.length > 0 ? config.domains : null;
		var requests;

		if (domains) {
			requests = domains.map(function (domain) {
				var path = basePath + "?" + buildParams(domain).join("&");
				return doRequest(path).catch(function (err) {
					console.error("[MMM-CurrentsNews] Domain '" + domain + "' fetch failed: " + err.message);
					return [];
				});
			});
		} else {
			var path = basePath + "?" + buildParams(null).join("&");
			requests = [doRequest(path).catch(function (err) {
				console.error("[MMM-CurrentsNews] Fetch failed: " + err.message);
				return [];
			})];
		}

		Promise.all(requests).then(function (resultsPerRequest) {
			var rawCount = 0;
			var newItems = [];
			resultsPerRequest.forEach(function (items) {
				rawCount += items.length;
				items.forEach(function (item) {
					newItems.push(normalize(item));
				});
			});

			if (!self.pools[identifier]) {
				self.pools[identifier] = [];
			}

			var existingKeys = self.pools[identifier].map(function (a) {
				return a.id || a.url;
			});

			var requireImage = config.articlesRequireImage !== "no";

			newItems.forEach(function (a) {
				if (requireImage && !hasValidImage(a)) {
					return;
				}
				var key = a.id || a.url;
				if (existingKeys.indexOf(key) === -1) {
					self.pools[identifier].push(a);
					existingKeys.push(key);
				}
			});

			var now = Date.now();

			function ageMs(a) {
				var t = parsePublishedMs(a.published);
				return isNaN(t) ? Infinity : (now - t);
			}

			// Drop anything older than 24h from the pool - permanently
			// irrelevant for a "recent headlines" display, and keeps the
			// pool from growing forever. Keep undated items (rare) at
			// lowest priority rather than dropping outright.
			self.pools[identifier] = self.pools[identifier].filter(function (a) {
				var age = ageMs(a);
				return age <= TWENTY_FOUR_HOURS_MS;
			});

			// Bound pool size defensively, keeping the newest.
			self.pools[identifier].sort(function (a, b) { return ageMs(a) - ageMs(b); });
			self.pools[identifier] = self.pools[identifier].slice(0, POOL_CAP);

			var pool = self.pools[identifier];
			var targetTotal = config.maxNewsItems || 20;
			var halfTarget = Math.ceil(targetTotal / 2);

			var recentPool = pool.filter(function (a) { return ageMs(a) <= FIVE_HOURS_MS; });
			var midPool = pool.filter(function (a) { return ageMs(a) > FIVE_HOURS_MS && ageMs(a) <= TWENTY_FOUR_HOURS_MS; });

			var selected = recentPool.slice(0, halfTarget);

			function usedKeys() {
				return selected.map(function (a) { return a.id || a.url; });
			}

			var remaining = targetTotal - selected.length;
			if (remaining > 0) {
				selected = selected.concat(midPool.slice(0, remaining));
			}

			remaining = targetTotal - selected.length;
			if (remaining > 0) {
				var keys = usedKeys();
				var leftoverRecent = recentPool.filter(function (a) {
					return keys.indexOf(a.id || a.url) === -1;
				});
				selected = selected.concat(leftoverRecent.slice(0, remaining));
			}

			remaining = targetTotal - selected.length;
			if (remaining > 0) {
				var keys2 = usedKeys();
				var leftoverMid = midPool.filter(function (a) {
					return keys2.indexOf(a.id || a.url) === -1;
				});
				selected = selected.concat(leftoverMid.slice(0, remaining));
			}

			// Final display order: newest first.
			selected.sort(function (a, b) { return ageMs(a) - ageMs(b); });

			console.log("[MMM-CurrentsNews] " + (domains ? domains.length + " domain requests" : "1 generic request") +
				", " + rawCount + " raw, " + pool.length + " in 24h pool, " +
				recentPool.length + " under 5h, " + selected.length + " selected for display.");

			self.sendSocketNotification("CURRENTSNEWS_RESULT", {
				identifier: identifier,
				articles: selected
			});
		}).catch(function (err) {
			console.error("[MMM-CurrentsNews] Unexpected fetch pipeline error: " + err.message);
			self.sendSocketNotification("CURRENTSNEWS_ERROR", {
				identifier: identifier,
				error: err.message
			});
		});
	}
});
