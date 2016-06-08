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

angular.module('mm.core.fileuploader')

.constant('mmFileUploaderFileSizeWarning', 5242880)

.factory('$mmFileUploaderHelper', function($q, $mmUtil, $mmApp, $log, $translate, $window, $state,
        $mmFileUploader, $cordovaCamera, $cordovaCapture, $mmLang, $mmFS, $mmText, mmFileUploaderFileSizeWarning) {

    $log = $log.getInstance('$mmFileUploaderHelper');

    var self = {},
        filePickerDeferred;

    /**
     * Show a confirmation modal to the user if he is using a limited connection or the file size is higher than 5MB.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#confirmUploadFile
     * @param  {Number} size File's size.
     * @return {Promise}     Promise resolved when the user confirms or if there's no need to show a modal.
     */
    self.confirmUploadFile = function(size) {
        if (!$mmApp.isOnline()) {
            return $mmLang.translateAndReject('mm.fileuploader.errormustbeonlinetoupload');
        }

        if ($mmApp.isNetworkAccessLimited() || size >= mmFileUploaderFileSizeWarning) {
            size = $mmText.bytesToSize(size, 2);
            return $mmUtil.showConfirm($translate('mm.fileuploader.confirmuploadfile', {size: size}));
        } else {
            return $q.when();
        }
    };

    /**
     * Create a temporary copy of a file and upload it.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#copyAndUploadFile
     * @param {Object} file File to copy and upload.
     * @return {Promise}    Promise resolved when the file is uploaded.
     */
    self.copyAndUploadFile = function(file) {
        var modal = $mmUtil.showModalLoading('mm.fileuploader.readingfile', true);

        // We have the data of the file to be uploaded, but not its URL (needed). Create a copy of the file to upload it.
        return $mmFS.readFileData(file, $mmFS.FORMATARRAYBUFFER).then(function(data) {
            var filepath = $mmFS.getTmpFolder() + '/' + file.name;

            return $mmFS.writeFile(filepath, data).then(function(fileEntry) {
                modal.dismiss();
                return self.uploadGenericFile(fileEntry.toURL(), file.name, file.type);
            }, function(error) {
                $log.error('Error writing file to upload: '+JSON.stringify(error));
                modal.dismiss();
                return $mmLang.translateAndReject('mm.fileuploader.errorreadingfile');
            });
        }, function(error) {
            $log.error('Error reading file to upload: '+JSON.stringify(error));
            modal.dismiss();
            return $mmLang.translateAndReject('mm.fileuploader.errorreadingfile');
        });
    };

    /**
     * Function called when the file picker is closed.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#filePickerClosed
     * @return {Void}
     */
    self.filePickerClosed = function() {
        if (filePickerDeferred) {
            filePickerDeferred.reject();
            filePickerDeferred = undefined;
        }
    };

    /**
     * Function to call once a file is uploaded using the file picker.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#fileUploaded
     * @param {Mixed} result Result of the upload process.
     * @return {Void}
     */
    self.fileUploaded = function(result) {
        if (filePickerDeferred) {
            filePickerDeferred.resolve(result);
            filePickerDeferred = undefined;
        }
    };

    /**
     * Open the view to select and upload a file.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#selectAndUploadFile
     * @return {Promise} Promise resolved when a file is uploaded, rejected if file picker is closed without a file uploaded.
     */
    self.selectAndUploadFile = function() {
        filePickerDeferred = $q.defer();
        $state.go('site.fileuploader-picker');
        return filePickerDeferred.promise;
    };

    /**
     * Convenience function to upload a file on a certain site, showing a confirm if needed.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#showConfirmAndUploadInSite
     * @param  {String} fileEntry FileEntry of the file to upload.
     * @param  {String} [siteid]  Id of the site to upload the file to. If not defined, use current site.
     * @return {Promise}          Promise resolved when the file is uploaded.
     */
    self.showConfirmAndUploadInSite = function(fileEntry, siteId) {
        return $mmFS.getFileObjectFromFileEntry(fileEntry).then(function(file) {
            return self.confirmUploadFile(file.size).then(function() {
                return self.uploadGenericFile(fileEntry.toURL(), file.name, file.type, siteId).then(function() {
                    $mmUtil.showModal('mm.core.success', 'mm.fileuploader.fileuploaded');
                });
            }).catch(function(err) {
                if (err) {
                    $mmUtil.showErrorModal(err);
                }
                return $q.reject();
            });
        }, function() {
            $mmUtil.showErrorModal('mm.fileuploader.errorreadingfile', true);
            return $q.reject();
        });
    };

    /**
     * Convenient helper for the user to record and upload a video.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#uploadAudioOrVideo
     * @param  {Boolean} isAudio True if uploading an audio, false if it's a video.
     * @return {Promise}         The reject contains the error message, if there is no error message
     *                           then we can consider that this is a silent fail.
     */
    self.uploadAudioOrVideo = function(isAudio) {
        $log.debug('Trying to record a video file');
        var fn = isAudio ? $cordovaCapture.captureAudio : $cordovaCapture.captureVideo;
        return fn({limit: 1}).then(function(medias) {
            // Upload the video.
            var modal = $mmUtil.showModalLoading('mm.fileuploader.uploading', true);
            return $mmFileUploader.uploadMedia(medias).catch(function(error) {
                if (typeof error == 'string') {
                    return $q.reject(error);
                }
                return $mmLang.translateAndReject('mm.fileuploader.errorwhileuploading');
            }).finally(function() {
                modal.dismiss();
            });
        }, function(error) {
            var defaultError = isAudio ? 'mm.fileuploader.errorcapturingaudio' : 'mm.fileuploader.errorcapturingvideo';
            return treatCaptureError(error, defaultError);
        });
    };

    /**
     * Uploads a file of any type.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#uploadGenericFile
     * @param  {String} uri      File URI.
     * @param  {String} name     File name.
     * @param  {String} type     File type.
     * @param  {String} [siteid] Id of the site to upload the file to. If not defined, use current site.
     * @return {Promise}         Promise resolved when the file is uploaded.
     */
    self.uploadGenericFile = function(uri, name, type, siteid) {
        if (!$mmApp.isOnline()) {
            return $mmLang.translateAndReject('mm.fileuploader.errormustbeonlinetoupload');
        }

        var modal = $mmUtil.showModalLoading('mm.fileuploader.uploading', true);

        return $mmFileUploader.uploadGenericFile(uri, name, type, siteid).catch(function(error) {
            $log.error('Error uploading file: '+JSON.stringify(error));
            if (typeof error == 'string') {
                return $q.reject(error);
            }
            return $mmLang.translateAndReject('mm.fileuploader.errorwhileuploading');
        }).finally(function() {
            modal.dismiss();
        });
    };

    /**
     * Convenient helper for the user to upload an image, either from the album or taking it with the camera.
     *
     * @module mm.core.fileuploader
     * @ngdoc method
     * @name $mmFileUploaderHelper#uploadImage
     * @param  {Boolean} fromAlbum True if the image should be selected from album, false if it should be taken with camera.
     * @return {Promise}           The reject contains the error message, if there is no error message
     *                             then we can consider that this is a silent fail.
     */
    self.uploadImage = function(fromAlbum) {
        $log.debug('Trying to capture an image with camera');
        var options = {
            quality: 50,
            destinationType: navigator.camera.DestinationType.FILE_URI
        };

        if (fromAlbum) {
            options.sourceType = navigator.camera.PictureSourceType.PHOTOLIBRARY;
            options.popoverOptions = new CameraPopoverOptions(10, 10, $window.innerWidth  - 200, $window.innerHeight - 200,
                                            Camera.PopoverArrowDirection.ARROW_ANY);
        }

        return $cordovaCamera.getPicture(options).then(function(img) {
            // Upload the image.
            var modal = $mmUtil.showModalLoading('mm.fileuploader.uploading', true);
            return $mmFileUploader.uploadImage(img, fromAlbum).catch(function(error) {
                if (typeof error == 'string') {
                    return $q.reject(error);
                }
                return $mmLang.translateAndReject('mm.fileuploader.errorwhileuploading');
            }).finally(function() {
                modal.dismiss();
            });
        }, function(error) {
            var defaultError = fromAlbum ? 'mm.fileuploader.errorgettingimagealbum' : 'mm.fileuploader.errorcapturingimage';
            return treatImageError(error, defaultError);
        });
    };

    /**
     * Treat a capture image or browse album error.
     *
     * @param  {String} error          Error returned by the Cordova plugin.
     * @param  {String} defaultMessage Key of the default message to show.
     */
    function treatImageError(error, defaultMessage) {
        // Cancelled, or error. If cancelled, error is a string with "Selection cancelled." or "Camera cancelled.".
        if (error) {
            if (typeof error == 'string') {
                if (error.toLowerCase().indexOf("error") > -1 || error.toLowerCase().indexOf("unable") > -1) {
                    $log.error('Error getting image: ' + error);
                    return $q.reject(error);
                } else {
                    $log.debug('Cancelled');
                }
            } else {
                return $mmLang.translateAndReject(defaultMessage);
            }
        }
        return $q.reject();
    }

    /**
     * Treat a capture audio/video error.
     *
     * @param  {Mixed} error           Error returned by the Cordova plugin. Can be a string or an object.
     * @param  {String} defaultMessage Key of the default message to show.
     */
    function treatCaptureError(error, defaultMessage) {
        // Cancelled, or error. If cancelled, error is an object with code = 3.
        if (error) {
            if (typeof error === 'string') {
                $log.error('Error while recording audio/video: ' + error);
                if (error.indexOf('No Activity found') > -1) {
                    // User doesn't have an app to do this.
                    return $mmLang.translateAndReject('mm.fileuploader.errornoapp');
                } else {
                    return $mmLang.translateAndReject(defaultMessage);
                }
            } else {
                if (error.code != 3) {
                    // Error, not cancelled.
                    $log.error('Error while recording audio/video: ' + JSON.stringify(error));
                    return $mmLang.translateAndReject(defaultMessage);
                } else {
                    $log.debug('Cancelled');
                }
            }
        }
        return $q.reject();
    }

    return self;
});
