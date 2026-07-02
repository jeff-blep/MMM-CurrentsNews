/* MMM-CurrentsNews node_helper.js
 * Fetches articles from the Currents API (https://currentsapi.services)
 * and hands them back to the frontend module.
 *
 * Uses Node's built-in https module so there are no extra npm dependencies
 * to install or go stale.
 *
 * When config.domains is set, this fires one request PER domain (Currents
 * supports server-side single-domain filtering) rather than fetching a
 * generic feed and hoping the target outlets show up by chance. This
 * guarantees relevant results instead of gambling against a 120,000+
 * source firehose.
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

		// Decide whether to do one generic fetch, or one fetch per domain.
		var domains = Array.isArray(config.domains) && config.domains.length > 0 ? config.domains : null;
		var requests;

		if (domains) {
			requests = domains.map(function (domain) {
				var path = basePath + "?" + buildParams(domain).join("&");
				return doRequest(path).catch(function (err) {
					console.error("[MMM-CurrentsNews] Domain '" + domain + "' fetch failed: " + err.message);
					return []; // don't let one bad domain kill the whole cycle
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
			var allItems = [];
			resultsPerRequest.forEach(function (items) {
				rawCount += items.length;
				items.forEach(function (item) {
					allItems.push(normalize(item));
				});
			});

			// Sort newest-first across merged domain results.
			allItems.sort(function (a, b) {
				return new Date(b.published) - new Date(a.published);
			});

			if (!self.buffers[identifier]) {
				self.buffers[identifier] = [];
			}

			var existingKeys = self.buffers[identifier].map(function (a) {
				return a.id || a.url;
			});

			allItems.forEach(function (a) {
				var key = a.id || a.url;
				if (existingKeys.indexOf(key) === -1) {
					self.buffers[identifier].unshift(a);
					existingKeys.push(key);
				}
			});

			var maxKeep = config.maxNewsItems || 20;
			self.buffers[identifier] = self.buffers[identifier].slice(0, maxKeep);

			var resultArticles = self.buffers[identifier];

			console.log("[MMM-CurrentsNews] " + (domains ? domains.length + " domain requests" : "1 generic request") +
				", " + rawCount + " raw articles, " + resultArticles.length + " total in buffer.");

			self.sendSocketNotification("CURRENTSNEWS_RESULT", {
				identifier: identifier,
				articles: resultArticles
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
