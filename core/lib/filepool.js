// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.core')

.constant('mmFilepoolQueueProcessInterval', 300)
.constant('mmFilepoolQueuePauseEmptyQueue', 5000)
.constant('mmFilepoolQueuePauseFSNetwork', 30000)

.constant('mmFilepoolFolder', 'filepool')
.constant('mmFilepoolStore', 'filepool')
.constant('mmFilepoolQueueStore', 'files_queue')
.constant('mmFilepoolLinksStore', 'files_links')

.config(function($mmAppProvider, $mmSiteProvider, mmFilepoolStore, mmFilepoolLinksStore, mmFilepoolQueueStore) {
    var siteStores = [
        {
            // File store.
            //
            // Each entry should contain:
            // - fileId: A hash of the file info.
            // - url: URL to download the file.
            // - modified: The time at which the file was last downloaded.
            // - stale: When true, it means that the file should be redownloaded.
            // - etag: Store the ETAG code of the file.
            name: mmFilepoolStore,
            keyPath: 'fileId',
            indexes: [
                {
                    name: 'modified',
                }
            ]
        },
        {
            // Associations between files and components.
            //
            // Each entry should contain:
            // - fileId: Hash used in the file store.
            // - component: The component name (e.g. mmaModPage).
            // - componentId: An ID that can be used by the component. -1 when not provided.
            name: mmFilepoolLinksStore,
            keyPath: ['fileId', 'component', 'componentId'],
            indexes: [
                {
                    name: 'fileId',
                },
                {
                    name: 'component',
                },
                {
                    // Not using compound indexes because they seem to have issues with where().
                    name: 'componentAndId',
                    generator: function(obj) {
                        return [obj.component, obj.componentId];
                    }
                }
            ]
        },
    ];
    var appStores = [
        {
            // Files queue.
            //
            // Each entry should contain:
            // - siteId: The site ID.
            // - fileId: A hash of the file info.
            // - url: URL to download the file.
            // - added: Timestamp (in milliseconds) at which the file was added to the queue.
            // - priority: Indicates which files should be treated first. Maximum value is 999.
            // - links: Array of objects containing component and ID to create links once the file has been processed.
            name: mmFilepoolQueueStore,
            keyPath: ['siteId', 'fileId'],
            indexes: [
                {
                    name: 'siteId',
                },
                {
                    name: 'sortorder',
                    generator: function(obj) {
                        // Creates an index to sort the queue items by priority, sort is ascending.
                        // The oldest are considered to be the most important onces.
                        // The additional priority argument allows to bump any queue item on top of the queue.
                        // The index will look as follow:
                        //    [999 - priority] + "-" + timestamp
                        //    "999-1431491086913": item without priority.
                        //    "900-1431491086913": item with priority of 99.
                        //    "000-1431491086913": item with max priority.

                        var sortorder = parseInt(obj.added, 10),
                            priority = 999 - Math.max(0, Math.min(parseInt(obj.priority || 0, 10), 999)),
                            padding = "000";

                        // Convert to strings.
                        sortorder = "" + sortorder;
                        priority = "" + priority;

                        // Final format.
                        priority = padding.substring(0, padding.length - priority.length) + priority;
                        sortorder = priority + '-' + sortorder;

                        return sortorder;
                    }
                }
            ]
        }
    ];
    $mmAppProvider.registerStores(appStores);
    $mmSiteProvider.registerStores(siteStores);
})

/**
 * Factory for handling the files in the pool.
 *
 * @module mm.core
 * @ngdoc factory
 * @name $mmFilepool
 * @todo Use transactions?
 * @todo Setting files as stale after a certain time
 * @todo Use ETAGs
 */
.factory('$mmFilepool', function($q, $log, $timeout, $mmApp, $mmFS, $mmWS, $mmSitesManager, md5, mmFilepoolStore,
        mmFilepoolLinksStore, mmFilepoolQueueStore, mmFilepoolFolder, mmFilepoolQueueProcessInterval,
        mmFilepoolQueuePauseFSNetwork, mmFilepoolQueuePauseEmptyQueue) {

    $log = $log.getInstance('$mmFilepool');

    var self = {},
        tokenRegex = new RegExp('(\\?|&)token=([A-Za-z0-9]+)'),
        pauseQueueUntil,
        urlAttributes = [
            tokenRegex,
            new RegExp('(\\?|&)forcedownload=[0-1]')
        ];

    // Error codes.
    var ERR_QUEUE_IS_EMPTY = 'mmFilepoolError:ERR_QUEUE_IS_EMPTY',
        ERR_FS_OR_NETWORK_UNAVAILABLE = 'mmFilepoolError:ERR_FS_OR_NETWORK_UNAVAILABLE',
        ERR_QUEUE_ON_PAUSE = 'mmFilepoolError:ERR_QUEUE_ON_PAUSE';

    /**
     * Convenient site DB getter.
     */
    function getSiteDb(siteId) {
        return $mmSitesManager.getSiteDb(siteId);
    }

    /**
     * Link a file with a component.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_addFileLink
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @param {String} component The component to link the file to.
     * @param {Number} [componentId] An ID to use in conjunction with the component.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to silently ignore failures.
     * @protected
     */
    self._addFileLink = function(siteId, fileId, component, componentId) {
        componentId = (typeof componentId === 'undefined') ? -1 : componentId;
        return getSiteDb(siteId).then(function(db) {
            return db.insert(mmFilepoolLinksStore, {
                fileId: fileId,
                component: component,
                componentId: componentId
            });
        });
    };

    /**
     * Link a file with a component by URL.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#addFileLinkByUrl
     * @param {String} siteId The site ID.
     * @param {String} fileUrl The file Url.
     * @param {String} component The component to link the file to.
     * @param {Number} [componentId] An ID to use in conjunction with the component.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to silently ignore failures.
     * @description
     * Use this method to create a link between a URL and a file. You usually do not need to call
     * this manually as adding a file to queue allows you to do so. Note that this method
     * does not check if the file exists in the pool, so you probably want to use is after
     * a successful {@link $mmFilepool#_downloadUrlAndAddToPool}.
     */
    self.addFileLinkByUrl = function(siteId, fileUrl, component, componentId) {
        var fileId = self._getFileIdByUrl(fileUrl);
        return self._addFileLink(siteId, fileId, component, componentId);
    };

    /**
     * Link a file with a component.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_addFileLinks
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @param {Object[]} links Array of objects containing the link component and optionally componentId.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to silently ignore failures.
     * @protected
     */
    self._addFileLinks = function(siteId, fileId, links) {
        var promises = [];
        angular.forEach(links, function(link) {
            promises.push(self._addFileLink(siteId, fileId, link.component, link.componentId));
        });
        return $q.all(promises);
    };

    /**
     * Add a file to the pool.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_addFileToPool
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @param {Object} data Additional information to store about the file (modified, url, ...). See mmFilepoolStore schema.
     * @return {Promise}
     * @protected
     * @description
     * Note that this method will override any existing entry with the same key.
     * That is the only way to update an entry.
     */
    self._addFileToPool = function(siteId, fileId, data) {
        var values = angular.copy(data) || {};
        values.fileId = fileId;
        return getSiteDb(siteId).then(function(db) {
            return db.insert(mmFilepoolStore, values);
        });
    };

    /**
     * Add an entry to queue using a URL.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#addToQueueByUrl
     * @param {String} siteId The site ID.
     * @param {String} url The absolute URL to the file.
     * @param {String} [component] The component to link the file to.
     * @param {Number} [componentId] An ID to use in conjunction with the component (optional).
     * @param {Number} [priority=0] The priority this file should get in the queue (range 0-999).
     * @return {Promise} Resolved on success. The returned value can be inconsistent, do not use.
     */
    self.addToQueueByUrl = function(siteId, url, component, componentId, priority) {
        var db = $mmApp.getDB(),
            fileId,
            now = new Date(),
            link;

        fileId = self._getFileIdByUrl(url);
        priority = priority || 0;

        // Set up the component.
        if (typeof component !== 'undefined') {
            link = {
                component: component,
                componentId: componentId
            };
        }

        return db.get(mmFilepoolQueueStore, [siteId, fileId]).then(function(fileObject) {
            var foundLink = false,
                update = false;

            if (fileObject) {
                // We already have the file in queue, we update the priority and links.
                if (fileObject.priority < priority) {
                    update = true;
                    fileObject.priority = priority;
                }

                if (link) {
                    // We need to add the new link if it does not exist yet.
                    angular.forEach(fileObject.links, function(fileLink) {
                        if (fileLink.component == link.component && fileLink.componentId == link.componentId) {
                            foundLink = true;
                        }
                    });
                    if (!foundLink) {
                        update = true;
                        fileObject.links.push(link);
                    }
                }

                if (update) {
                    // Update only when required.
                    $log.debug('Updating file ' + fileId + ' which is already in queue');
                    return db.insert(mmFilepoolQueueStore, fileObject);
                }

                var response = (function() {
                    // Return a resolved promise containing the keyPath such as db.insert() does it.
                    var deferred = $q.defer();
                    deferred.resolve([fileObject.siteId, fileObject.fileId]);
                    return deferred.promise;
                })();

                $log.debug('File ' + fileId + ' already in queue and does not require update');
                return response;
            } else {
                return addToQueue();
            }
        }, function() {
            // Unsure why we could not get the record, let's add to the queue anyway.
            return addToQueue();
        });

        function addToQueue() {
            $log.debug('Adding ' + fileId + ' to the queue');
            return db.insert(mmFilepoolQueueStore, {
                siteId: siteId,
                fileId: fileId,
                added: now.getTime(),
                priority: priority,
                url: url,
                links: link ? [link] : []
            });
        }
    };

    /**
     * Returns whether a component has files in the pool.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#componentHasFiles
     * @param {String} siteId The site ID.
     * @param {String} component The component to link the file to.
     * @param {Number} [componentId] An ID to use in conjunction with the component.
     * @return {Promise} Resolved means yes, rejected means no.
     */
    self.componentHasFiles = function(siteId, component, componentId) {
        return getSiteDb(siteId).then(function(db) {
            var where;
            if (typeof componentId !== 'undefined') {
                where = ['componentAndId', '=', [component, componentId]];
            } else {
                where = ['component', '=', component];
            }
            return db.count(mmFilepoolLinksStore, where).then(function(count) {
                if (count > 0) {
                    return true;
                }
                return $q.reject();
            });
        });
    };

    /**
     * Downloads a file on the spot.
     *
     * This will also take care of adding the file to the pool if it's missing.
     * However, please note that this will not force a file to be re-downloaded
     * if it is already part of the pool. You should mark a file as stale using
     * {@link $mmFilepool#invalidateFileByUrl} to trigger a download.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#downloadUrl
     * @param {String} siteId The site ID.
     * @param {String} fileUrl The file URL.
     * @return {Promise} Resolved with internal URL on success, rejected otherwise.
     */
    self.downloadUrl = function(siteId, fileUrl) {
        var fileId = self._getFileIdByUrl(fileUrl),
            now = new Date();

        if (!$mmFS.isAvailable()) {
            return $q.reject();
        }

        return self._hasFileInPool(siteId, fileId).then(function(fileObject) {

            if (typeof fileObject === 'undefined') {
                // We do not have the file, download and add to pool.
                return self._downloadForPoolByUrl(siteId, fileUrl);

            } else if (fileObject.stale && $mmApp.isOnline()) {
                // The file is outdated, force the download and update it.
                return self._downloadForPoolByUrl(siteId, fileUrl, fileObject);
            }

            // Everything is fine, return the file on disk.
            return self._getFileInternalUrlById(siteId, fileId);

        }, function() {

            // The file is not in the pool just yet.
            return self._downloadForPoolByUrl(siteId, fileUrl);
        });
    };

    /**
     * Downloads a URL and update or add it to the pool.
     *
     * This uses the file system, you should always make sure that it is
     * accessible before calling this method.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_downloadForPoolByUrl
     * @param {String} siteId The site ID.
     * @param {String} fileUrl The file URL.
     * @param {Object} [poolFileObject] When set, the object will be updated, a new entry will not be created.
     * @return {Promise} Resolved with internal URL on success, rejected otherwise.
     * @protected
     */
    self._downloadForPoolByUrl = function(siteId, fileUrl, poolFileObject) {
        var fileId = self._getFileIdByUrl(fileUrl),
            filePath = self._getFilePath(siteId, fileId);

        if (poolFileObject && poolFileObject.fileId !== fileId) {
            $log.error('Invalid object to update passed');
            return $q.reject();
        }

        return $mmWS.downloadFile(fileUrl, filePath).then(function(fileEntry) {
            var now = new Date(),
                data = poolFileObject || {};

            data.modified = now.getTime();
            data.stale = false;
            data.url = fileUrl;

            return self._addFileToPool(siteId, fileId, data).then(function() {
                return fileEntry.toInternalURL();
            });
        });
    };

    /**
     * Is the file already in the pool?
     *
     * This does not check if the file is on the disk.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_hasFileInPool
     * @param {String} siteId The site ID.
     * @param {String} fileUrl The file URL.
     * @return {Promise} Resolved with file object from DB on success, rejected otherwise.
     * @protected
     */
    self._hasFileInPool = function(siteId, fileId) {
        return getSiteDb(siteId).then(function(db) {
            return db.get(mmFilepoolStore, fileId).then(function(fileObject) {
                if (typeof fileObject === 'undefined') {
                    return $q.reject();
                }
                return fileObject;
            });
        });
    };

    /**
     * Creates a unique ID based on a URL.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_getFileIdByUrl
     * @param {String} fileUrl The absolute URL to the file.
     * @return {String} The file ID.
     * @protected
     */
    self._getFileIdByUrl = function(fileUrl) {
        var url = fileUrl;
        if (url.indexOf('/webservice/pluginfile') !== -1) {
            // Remove attributes that do not matter.
            angular.forEach(urlAttributes, function(regex) {
                url = url.replace(regex, '');
            });
        }
        return md5.createHash('url:' + url);
    };

    /**
     * Returns an absolute URL to access the file URL.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#getFileUrlByUrl
     * @param {String} siteId The site ID.
     * @param {String} fileUrl The absolute URL to the file.
     * @return {Promise} Resolved with the URL to use. When rejected, nothing could be done,
     *                   which means that you should not even use the fileUrl passed.
     * @description
     * This will return a URL pointing to the content of the requested URL.
     *
     * If the URL is unknown to us, it will be added to a queue to be downloaded and stored
     * for offline use. Once the URL is known, when requested again the downloaded file
     * interal URL will be returned.
     *
     * If we do not have the file, and the app does not have network access, the promise
     * will be rejected. In any other case either the local URL, or the original URL will be returned.
     */
    self.getFileUrlByUrl = function(siteId, fileUrl) {
        var fileId = self._getFileIdByUrl(fileUrl);
        return self._hasFileInPool(siteId, fileId).then(function(fileObject) {
            var response,
                addToQueue = false;

            if (typeof fileObject === 'undefined') {
                // We do not have the file, add it to the queue, and return real URL.
                self.addToQueueByUrl(siteId, fileUrl);
                response = fileUrl;
            } else if (fileObject.stale && $mmApp.isOnline()) {
                // The file is outdated, we add to the queue and return real URL.
                self.addToQueueByUrl(siteId, fileUrl);
                response = fileUrl;
            } else {
                // We found the file entry, now look for the file on disk.
                response = self._getFileInternalUrlById(siteId, fileId).then(function(internalUrl) {
                    // Perfect, the file is on disk.
                    return internalUrl;
                }, function() {
                    // We have a problem here, we could not retrieve the file though we thought
                    // we had it, we will delete the entries associated with that ID.
                    $log.debug('File ' + fileId + ' not found on disk');
                    self._removeFileById(siteId, fileId);
                    self.addToQueueByUrl(siteId, fileUrl);

                    if ($mmApp.isOnline()) {
                        // We still have a chance to serve the right content.
                        return fileUrl;
                    }

                    return $q.reject();
                });
            }

            return response;
        }, function() {
            // We do not have the file in store yet.
            self.addToQueueByUrl(siteId, fileUrl);
            return fileUrl;
        });
    };

    /**
     * Returns the internal URL of a file.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_getFileInternalUrlById
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @return {Promise} Resolved with the internal URL. Rejected otherwise.
     * @protected
     */
    self._getFileInternalUrlById = function(siteId, fileId) {
        if ($mmFS.isAvailable()) {
            return $mmFS.getFile(self._getFilePath(siteId, fileId)).then(function(fileEntry) {
                // We use toInternalURL so images are loaded in iOS8 using img HTML tags,
                // with toURL the OS is unable to find the image files.
                return fileEntry.toInternalURL();
            });
        }
        return $q.reject();
    };

    /**
     * Get the path to a file.
     *
     * This does not check if the file exists or not.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_getFilePath
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @return {String} The path to the file relative to storage root.
     * @protected
     */
    self._getFilePath = function(siteId, fileId) {
        return $mmFS.getSiteFolder(siteId) + '/' + mmFilepoolFolder + '/' + fileId;
    };

    /**
     * Invalidate a file by URL.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_getFilePath
     * @param {String} siteId The site ID.
     * @param {String} fileUrl The file URL.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to ignore a failure.
     * @description
     * Invalidates a file by marking it stale. It will not be added to the queue automatically,
     * but the next time this file will be requested it will be added to the queue. This is to allow
     * for cache invalidation without necessarily re-triggering downloads.
     * You can manully call {@link $mmFilepool#addToQueueByUrl} to counter this behaviour.
     * Please note that when a file is marked as stale, the user will be presented the stale file
     * only if they do not have network access.
     */
    self.invalidateFileByUrl = function(siteId, fileUrl) {
        var fileId = self._getFileIdByUrl(fileUrl);
        return getSiteDb(siteId).then(function(db) {
            return db.get(mmFilepoolStore, fileId).then(function(fileObject) {
                if (!fileObject) {
                    // Nothing to do, we do not have the file in store.
                    return;
                }
                fileObject.stale = true;
                return db.insert(mmFilepoolStore, fileObject);
            });
        });
    };

    /**
     * Invalidate all the matching files from a component.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#invalidateFilesByComponent
     * @param {String} siteId The site ID.
     * @param {String} component The component to link the file to.
     * @param {Number} [componentId] An ID to use in conjunction with the component.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to ignore a failure.
     * @description
     * Invalidates a file by marking it stale. See {@link $mmFilepool#invalidateFileByUrl} for more details.
     */
    self.invalidateFilesByComponent = function(siteId, component, componentId) {
        var values = { stale: true },
            where;
        if (typeof componentId !== 'undefined') {
            where = ['componentAndId', '=', [component, componentId]];
        } else {
            where = ['component', '=', component];
        }
        return getSiteDb(siteId).then(function(db) {
            return db.query(mmFilepoolQueueStore, where).then(function(list) {
                angular.forEach(list, function(fileObject) {
                    fileObject.stale = true;
                    db.insert(mmFilepoolStore, fileObject);
                });
            });
        });
    };

    /**
     * Process the queue.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#processQueue
     * @return {Void}
     * @description
     * Processes the queue.
     *
     * This loops over itself to keep on processing the queue in the background.
     * The queue process is site agnostic.
     *
     * Never call this directly, its usage is reserved to core.
     */
    self.processQueue = function() {
        var deferred = $q.defer(),
            now = new Date(),
            promise;

        if (pauseQueueUntil && pauseQueueUntil.getTime() > now.getTime()) {
            // Silently ignore, the queue is on pause.
            deferred.reject(ERR_QUEUE_ON_PAUSE);
            promise = deferred.promise;

        } else if (!$mmFS.isAvailable() || !$mmApp.isOnline()) {
            deferred.reject(ERR_FS_OR_NETWORK_UNAVAILABLE);
            promise = deferred.promise;

        } else {
            promise = self._processImportantQueueItem();
        }

        promise.then(function() {
            // All good.
        }, function(error) {
            var now = new Date(),
                pause;

            // We found an error, in which case we might want to hold onto the queue processing.
            if (error === ERR_FS_OR_NETWORK_UNAVAILABLE) {
                pause = new Date(now.getTime() + mmFilepoolQueuePauseFSNetwork);
                $log.debug('Filesysem or network unavailable, pausing queue processing for ' +
                    mmFilepoolQueuePauseFSNetwork + 'ms.');

            } else if (error === ERR_QUEUE_IS_EMPTY) {
                pause = new Date(now.getTime() + mmFilepoolQueuePauseEmptyQueue);
                $log.debug('Queue is empty, pausing queue processing for ' +
                    mmFilepoolQueuePauseEmptyQueue + 'ms.');
            }

            if (pause) {
                pauseQueueUntil = pause;
            }

        }).finally(function() {
            // Trigger next execution.
            $timeout(self.processQueue, mmFilepoolQueueProcessInterval);
        });
    };

    /**
     * Process the most important queue item.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_processImportantQueueItem
     * @return {Promise} Resolved on success. Rejected on failure.
     */
    self._processImportantQueueItem = function() {
        return $mmApp.getDB().query(mmFilepoolQueueStore, undefined, 'sortorder', undefined, 1)
        .then(function(items) {
            var item = items.pop();
            if (!item) {
                return $q.reject(ERR_QUEUE_IS_EMPTY);
            }
            return self._processQueueItem(item);
        }, function() {
            return $q.reject(ERR_QUEUE_IS_EMPTY);
        });
    };

    /**
     * Process a queue item.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_processQueueItem
     * @param {Object} item The object from the queue store.
     * @return {Promise} Resolved on success. Rejected on failure.
     * @protected
     */
    self._processQueueItem = function(item) {
        var siteId = item.siteId,
            fileId = item.fileId,
            fileUrl = item.url,
            links = item.links || [];

        $log.debug('Processing queue item: ' + siteId + ', ' + itemId);
        return getSiteDb(siteId).then(function(db) {
            db.get(mmFilepoolStore, fileId).then(function(fileObject) {
                if (fileObject && !fileObject.stale) {
                    // We have the file, it is not stale, we can update links and remove from queue.
                    self._addFileLinks(siteId, fileId, links);
                    self._removeFromQueue(siteId, fileId);
                    $log.debug('Queued file already in store, ignoring...');
                    return;
                }
                // The file does not exist, or is stale, ... download it.
                return download(siteId, fileUrl, fileObject, links);
            }, function() {
                // The file does not exist, download it.
                return download(siteId, fileUrl, undefined, links);
            });
        });

        /**
         * Download helper to avoid code duplication.
         */
        function download(siteId, fileUrl, fileObject, links) {
            return self._downloadForPoolByUrl(siteId, fileUrl, fileObject).then(function() {
                // Success, we add links and remove from queue.
                self._addFileLinks(siteId, fileId, links);
                self._removeFromQueue(siteId, fileId);

            }, function(errorObject) {
                // Whoops, we have an error...
                var dropFromQueue = false;

                if (typeof errorObject !== 'undefined' && errorObject.source === fileUrl) {
                    // This is most likely a $cordovaFileTransfer error.

                    if (errorObject.code === 1) { // FILE_NOT_FOUND_ERR.
                        // The file was not found, most likely a 404, we remove from queue.
                        dropFromQueue = true;

                    } else if (errorObject.code === 2) { // INVALID_URL_ERR.
                        // The URL is invalid, we drop the file from the queue.
                        dropFromQueue = true;

                    } else if (errorObject.code === 3) { // CONNECTION_ERR.

                        if (errorObject.http_status === 401) {
                            // The URL is not in the white list.
                            dropFromQueue = true;

                        } else if (!errorObject.http_status) {
                            // We are guessing that this was a connection issue, keep in queue.

                        } else {
                            // If there was an HTTP status, then let's remove from the queue.
                            dropFromQueue = true;
                        }

                    } else if (errorObject.code === 4) { // ABORTED_ERR.
                        // The transfer was aborted, we will keep the file in queue.

                    } else if (errorObject.code === 5) { // NOT_MODIFIED_ERR.
                        // We have the latest version of the file, HTTP 304 status.
                        dropFromQueue = true;

                    } else {
                        // Unknown error, let's remove the file from the queue to avoid
                        // locking down the queue because of one file.
                        dropFromQueue = true;
                    }
                }

                if (dropFromQueue) {
                    // Consider this as a silent error.
                    self._removeFromQueue(siteId, fileId);
                } else {
                    // We considered the file as legit but did not get it, failure.
                    return $q.reject();
                }

            });
        }

    };

    /**
     * Remove a file from the queue.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_removeFromQueue
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to silently ignore failures.
     * @protected
     */
    self._removeFromQueue = function(siteId, fileId) {
        return $mmApp.getDB().remove(mmFilepoolQueueStore, [siteId, fileId]);
    };

    /**
     * Remove a file from the pool.
     *
     * @module mm.core
     * @ngdoc method
     * @name $mmFilepool#_removeFileById
     * @param {String} siteId The site ID.
     * @param {String} fileId The file ID.
     * @return {Promise} Resolved on success. Rejected on failure. It is advised to silently ignore failures.
     * @protected
     */
    self._removeFileById = function(siteId, fileId) {
        return getSiteDb(siteId).then(function(db) {
            var p1, p2, p3;
            p1 = db.remove(mmFilepoolStore, fileId);
            p2 = db.where(mmFilepoolLinksStore, 'fileId', '=', fileId).then(function(entries) {
                angular.forEach(entries, function(entry) {
                    db.remove(mmFilepoolLinksStore, entry.id);
                });
            });
            p3 = $mmFS.removeFile(self._getFilePath(siteId, fileId));
            return $q.all([p1, p2, p3]);
        });
    };

    return self;
})

.run(function($log, $ionicPlatform, $timeout, $mmFilepool) {
    $log = $log.getInstance('$mmFilepool');

    $ionicPlatform.ready(function() {
        // Waiting for the platform to be ready, and a few more before we start processing the queue.
        $timeout($mmFilepool.processQueue, 1000);
    });

});
