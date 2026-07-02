/* global Module, Log, moment */

/* MMM-CurrentsNews
 * A MagicMirror2 module that displays news articles using the Currents API
 * (https://currentsapi.services), built as a drop-in replacement for the
 * old MMM-News module which relied on newsapi.org and its 24-hour free-tier
 * article delay.
 *
 * By Claude (Anthropic), for Jeff. MIT Licensed.
 */

Module.register("MMM-CurrentsNews", {

	defaults: {
		apiKey: "",
		mode: "latest",          // "latest" or "search"
		keywords: "",            // used when mode === "search"
		category: "",            // e.g. "science_technology", "sport", "" for all
		country: "",             // 2-letter country code, "" for all
		language: "en",
		domains: [],             // e.g. ["cnn.com","reuters.com"] - client-side filter, empty = no filter

		pageSize: 20,            // how many articles to fetch per request
		updateInterval: 60 * 30 * 1000,   // how often to re-fetch from the API (30 min default)
		rotateInterval: 1000 * 15,        // how often to flip to next article on screen
		animationSpeed: 1000,

		maxNewsItems: 20,        // cap how many fetched articles we keep in rotation
		showImage: true,
		showDescription: true,
		showSourceTitle: true,
		showPublishDate: true,
		truncDescription: 200,   // characters
		wrapTitle: true,

		layoutMode: "big",       // "compact" or "big" - matches MMM-MyPlex convention
		cardLayout: "auto",      // "auto", "left", or "right" - image/text alignment

		apiBase: "https://api.currentsapi.services/v1",

		templateFile: "template.html"
	},

	getStyles: function () {
		return ["MMM-CurrentsNews.css"];
	},

	getTemplate: function () {
		return this.config.templateFile;
	},

	start: function () {
		Log.info("Starting module: " + this.name);
		this.newsItems = [];
		this.currentIndex = 0;
		this.loaded = false;
		this.error = null;

		if (!this.config.apiKey) {
			Log.error(this.name + ": No apiKey configured. Get one free at https://currentsapi.services");
		}

		this.getNews();
		this.scheduleUpdate();
		this.scheduleRotate();
	},

	scheduleUpdate: function () {
		var self = this;
		setInterval(function () {
			self.getNews();
		}, this.config.updateInterval);
	},

	scheduleRotate: function () {
		var self = this;
		setInterval(function () {
			self.rotateNews();
		}, this.config.rotateInterval);
	},

	getNews: function () {
		this.sendSocketNotification("CURRENTSNEWS_FETCH", {
			identifier: this.identifier,
			config: this.config
		});
	},

	rotateNews: function () {
		if (!this.newsItems || this.newsItems.length === 0) {
			return;
		}
		this.currentIndex = (this.currentIndex + 1) % this.newsItems.length;
		this.updateDom(this.config.animationSpeed);
	},

	socketNotificationReceived: function (notification, payload) {
		if (payload && payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "CURRENTSNEWS_RESULT") {
			this.loaded = true;
			this.error = null;
			this.newsItems = payload.articles || [];
			this.currentIndex = 0;
			this.updateDom(this.config.animationSpeed);
		} else if (notification === "CURRENTSNEWS_ERROR") {
			this.loaded = true;
			this.error = payload.error || "Unknown error fetching news";
			Log.error(this.name + ": " + this.error);
			this.updateDom(this.config.animationSpeed);
		}
	},

	getTemplateData: function () {
		if (!this.config.apiKey) {
			return {
				loaded: true,
				error: "Missing apiKey. Get one free at currentsapi.services and add it to config.js",
				config: this.config
			};
		}

		if (this.error) {
			return {
				loaded: true,
				error: this.error,
				config: this.config
			};
		}

		if (!this.loaded || this.newsItems.length === 0) {
			return {
				loaded: this.loaded,
				error: null,
				config: this.config
			};
		}

		var article = this.newsItems[this.currentIndex];
		var description = article.description || "";
		if (this.config.truncDescription && description.length > this.config.truncDescription) {
			description = description.substring(0, this.config.truncDescription).trim() + "...";
		}

		var publishDate = "";
		if (article.published) {
			try {
				publishDate = moment(article.published).fromNow();
			} catch (e) {
				publishDate = article.published;
			}
		}

		var resolvedCardLayout = this.config.cardLayout;
		if (resolvedCardLayout === "auto") {
			var pos = this.data.position || "";
			resolvedCardLayout = pos.indexOf("right") !== -1 ? "right" : "left";
		}

		return {
			loaded: true,
			error: null,
			config: this.config,
			cardLayout: resolvedCardLayout,
			article: {
				title: article.title,
				description: description,
				url: article.url,
				image: article.image && article.image !== "None" ? article.image : null,
				author: article.author,
				source: article.sourceDomain || (article.author || ""),
				publishDate: publishDate
			}
		};
	}
});
