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
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "CURRENTSNEWS_FETCH") {
			this.fetchNews(payload.identifier, payload.config);
		}
	},

	fetchNews: function (identifier, config) {
		var self = this;

		if (!config.apiKey) {
			// The frontend already handles the missing-key message via
			// getTemplateData, so just bail quietly here.
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
			headers: {
				Authorization: config.apiKey
			}
		};

		var req = https.request(options, function (res) {
			var body = "";

			res.on("data", function (chunk) {
				body += chunk;
			});

			res.on("end", function () {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					self.sendSocketNotification("CURRENTSNEWS_ERROR", {
						identifier: identifier,
						error: "Currents API returned status " + res.statusCode + ": " + body
					});
					return;
				}

				try {
					var data = JSON.parse(body);

					if (data.status !== "ok" || !Array.isArray(data.news)) {
						self.sendSocketNotification("CURRENTSNEWS_ERROR", {
							identifier: identifier,
							error: "Unexpected response shape from Currents API"
						});
						return;
					}

					var articles = data.news.slice(0, config.maxNewsItems || data.news.length).map(function (item) {
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

					self.sendSocketNotification("CURRENTSNEWS_RESULT", {
						identifier: identifier,
						articles: articles
					});
				} catch (err) {
					self.sendSocketNotification("CURRENTSNEWS_ERROR", {
						identifier: identifier,
						error: "Failed to parse Currents API response: " + err.message
					});
				}
			});
		});

		req.on("error", function (err) {
			self.sendSocketNotification("CURRENTSNEWS_ERROR", {
				identifier: identifier,
				error: "Request to Currents API failed: " + err.message
			});
		});

		req.end();
	}
});
