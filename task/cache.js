var EventEmitter = require ('events').EventEmitter,
	crypto       = require ('crypto'),
	util         = require ('util'),
	urlUtil      = require ('url'),
	task         = require ('./base'),
	urlModel     = require ('./model/from-url');

var cachePath = project.config.cachePath;

if (!project.caching) {
	project.caching = {};
}

var cacheTask = module.exports = function (config) {

	this.url = config.url;

	this.init (config);

};

util.inherits (cacheTask, task);

util.extend (cacheTask.prototype, {
	/**
	 * Generates file name as a hash sum
	 * based on the cached file original URL.
	 */
	generateCacheFileName: function () {

		if (this.cacheFileName)
			return this.cacheFileName;

		var shasum = crypto.createHash('sha1');
		shasum.update(this.url.href);
		this.cacheFile = project.root.file_io (cachePath, shasum.digest('hex'));
		this.cacheFileName = this.cacheFile.path;

		return this.cacheFileName;
	}
});

util.extend (cacheTask.prototype, {
	/**
	 * @method run
	 * Downloads a given URL into a uniquely named file.
	 *
	 * @cfg {String} url (required) A URL to download from.
	 * @cfg {Number} [retries=0] The number of times to retry to run the task.
	 * @cfg {Number} [timeout=10000] Timeout for downloading of each file
	 * (in milliseconds)
	 */
	run: function () {

		var self = this;

		self.activityCheck ('task run');

		// create model and listen
		// model is a class for working with particular network protocol
		if (!self.model) {

			// console.log("self.model.url -> ", self.url.fetch.uri);
			try {
				self.model = new urlModel (self.url);
				self.url = self.model.url;
				self.model.url.protocol.length;
			} catch (e) {
				self.emitError(e);
				return;
			}
			self.model.on ('data', function (chunks) {
				self.activityCheck ('model.fetch data');
			});

			self.model.on ('error', function (e) {
				// console.log("%%%%%%%%%%cache failed");
				self.emitError(e);
			});

			self.model.on ('end', function () {
				/*var srcName = self.model.dataSource.res.headers['content-disposition'].match(/filename=\"([^"]+)/)[1];
				self.res = {};
				self.res.srcName = srcName ? srcName : "";
				console.log("self.res -> ", self.res);*/
				self.clearOperationTimeout();
				self.cacheFile.chmod (0640, function (err) {
					// TODO: check for exception (and what's next?)
					delete project.caching[self.cacheFileName];
					// self.res.cacheFileName = self.cacheFileName
					// self.completed (self.res);
					self.completed (self.cacheFileName);
				});
			});

		}

		this.generateCacheFileName ();

		// other task is caching requested url
		var anotherTask = project.caching[self.cacheFileName];

		if (anotherTask && anotherTask != self) {

			this.emit ('log', 'another process already downloading ' + this.url.href + ' to ' + this.cacheFileName);
			// we simply wait for another task
			anotherTask.on ('complete', function () {
				self.completed (self.cacheFileName);
			});
			anotherTask.on ('error', function (e) {
				self.emitError(e);
			});
			return;
		} else {
			project.caching[self.cacheFileName] = self;
		}

		self.cacheFile.stat (function (err, stats) {

			if (!err && (stats.mode & 0644 ^ 0600)) {

				self.clearOperationTimeout();

				self.emit ('log', 'file already downloaded from ' + self.url.href + ' to ' + self.cacheFileName);
				delete project.caching[self.cacheFileName];
				self.completed (self.cacheFileName);

				return;
			}

			try {
				var writeStream = self.cacheFile.writeStream ({
					flags: 'w', // constants.O_CREAT | constants.O_WRONLY
					mode: 0600
				});
			} catch (e) {
				self.emitError(e);
				return;
			}

			self.emit ('log', 'start caching from ' + self.url.href + ' to ' + self.cacheFileName);

			self.activityCheck ('model.fetch start');
			self.model.fetch ({to: writeStream});
		});
	},

	emitError: function (e) {
		if (e) {
			this.state = 5;
			this.emit('error', e);
			this.cancel();
			return true;
		} else {
			return false;
		}
	}
});
