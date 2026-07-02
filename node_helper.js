/* MMM-CurrentsNews node_helper.js
 * Fetches articles from the Currents API (https://currentsapi.services)
 * and hands them back to the frontend module.
 *
 * Uses Node's built-in https module so there are no extra npm dependencies
 * to install or go stale.
 */

const NodeHelper = require("node_helper");
const https = require("https");

module.exports = NodeHelper.create({

	start: function () {
		console.log("Starting node_helper for module: " + this.name);
		this.buffers = {}; // identifier -> array of accumulated articles
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

		var path = config.mode === "search" ? "/search" : "/latest-news";
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

		var query = params.length ? "?" + params.join("&") : "";
		var requestPath = "/v1" + path + query;

		var options = {
			hostname: "api.currentsapi.services",
			path: requestPath,
			method: "GET",
			family: 4,   // force IPv4 - avoids AggregateError on networks with no IPv6 route
			headers: {
				Authorization: config.apiKey
			}
		};

		console.log("[MMM-CurrentsNews] Fetching: https://api.currentsapi.services" + requestPath);

		var req = https.request(options, function (res) {			var body = "";

			res.on("data", function (chunk) {
				body += chunk;
			});

			res.on("end", function () {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					console.error("[MMM-CurrentsNews] API error " + res.statusCode + ": " + body);
					self.sendSocketNotification("CURRENTSNEWS_ERROR", {
						identifier: identifier,
						error: "Currents API returned status " + res.statusCode + ": " + body
					});
					return;
				}

				try {
					var data = JSON.parse(body);

					if (data.status !== "ok" || !Array.isArray(data.news)) {
						console.error("[MMM-CurrentsNews] Unexpected response shape: " + body.substring(0, 300));
						self.sendSocketNotification("CURRENTSNEWS_ERROR", {
							identifier: identifier,
							error: "Unexpected response shape from Currents API"
						});
						return;
					}

					var articles = data.news.map(function (item) {
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
					});

					// Currents' API only supports filtering by a single domain,
					// so when the user wants a specific list of outlets (the old
					// MMM-News "sources" behavior) we filter client-side instead.
					// Matching allows subdomains (e.g. "edition.cnn.com" matches
					// a configured "cnn.com") since outlets often serve under
					// regional or product subdomains rather than the bare domain.
					if (Array.isArray(config.domains) && config.domains.length > 0) {
						var wanted = config.domains.map(function (d) {
							return d.toLowerCase().replace(/^www\./, "");
						});
						articles = articles.filter(function (a) {
							var domain = a.sourceDomain.toLowerCase();
							return wanted.some(function (w) {
								return domain === w || domain.endsWith("." + w);
							});
						});
					}

					var newCount = articles.length;

					// Accumulate matches across fetches so a lean result (or a
					// zero-match cycle, common with a narrow domain filter on
					// the free tier's 20-article cap) doesn't wipe out articles
					// we already found in earlier fetches.
					if (!self.buffers[identifier]) {
						self.buffers[identifier] = [];
					}

					var existingIds = self.buffers[identifier].map(function (a) {
						return a.id || a.url;
					});

					articles.forEach(function (a) {
						var key = a.id || a.url;
						if (existingIds.indexOf(key) === -1) {
							self.buffers[identifier].unshift(a);
							existingIds.push(key);
						}
					});

					var maxKeep = config.maxNewsItems || 20;
					self.buffers[identifier] = self.buffers[identifier].slice(0, maxKeep);

					var resultArticles = self.buffers[identifier];

					console.log("[MMM-CurrentsNews] Fetched " + data.news.length + " articles, " +
						newCount + " matched filter, " + resultArticles.length + " total in buffer.");

					self.sendSocketNotification("CURRENTSNEWS_RESULT", {
						identifier: identifier,
						articles: resultArticles
					});
				} catch (err) {
					console.error("[MMM-CurrentsNews] Failed to parse response: " + err.message);
					self.sendSocketNotification("CURRENTSNEWS_ERROR", {
						identifier: identifier,
						error: "Failed to parse Currents API response: " + err.message
					});
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
			console.error("[MMM-CurrentsNews] Request failed: " + details);
			self.sendSocketNotification("CURRENTSNEWS_ERROR", {
				identifier: identifier,
				error: "Request to Currents API failed: " + details
			});
		});

		req.setTimeout(15000, function () {
			console.error("[MMM-CurrentsNews] Request timed out after 15s");
			req.destroy(new Error("Request timed out after 15s"));
		});

		req.end();
	}
});
