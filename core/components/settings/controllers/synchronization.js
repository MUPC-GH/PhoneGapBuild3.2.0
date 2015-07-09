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

angular.module('mm.core.settings')

/**
 * Controller to handle the app 'Synchronization' section in settings.
 *
 * @module mm.core.settings
 * @ngdoc controller
 * @name mmSettingsSynchronizationCtrl
 */
.controller('mmSettingsSynchronizationCtrl', function($log, $scope, $mmSitesManager, $mmUtil, $mmFilepool) {
    $log = $log.getInstance('mmSettingsSynchronizationCtrl');

    $mmSitesManager.getSites().then(function(sites) {
        $scope.sites = sites;
    });

    $scope.synchronize = function(siteData) {
        if (siteData) {
            var siteid = siteData.id,
                modal = $mmUtil.showModalLoading('mm.settings.synchronizing', true);
            $mmFilepool.invalidateAllFiles(siteid).finally(function() {
                $mmSitesManager.getSite(siteid).then(function(site) {
                    return site.invalidateWsCache().then(function() {
                        return $mmSitesManager.updateSiteInfo(siteid);
                    }).then(function() {
                        siteData.fullname = site.getInfo().fullname;
                        siteData.sitename = site.getInfo().sitename;
                        $mmUtil.showModal('mm.settings.success', 'mm.settings.syncsitesuccess');
                    });
                }).catch(function() {
                    $mmUtil.showErrorModal('mm.settings.errorsyncsite', true);
                }).finally(function() {
                    modal.dismiss();
                });
            });
        }
    };
});
