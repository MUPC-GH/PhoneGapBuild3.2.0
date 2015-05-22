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

angular.module('mm.addons.mod_resource')

/**
 * Resource index controller.
 *
 * @module mm.addons.mod_resource
 * @ngdoc controller
 * @name mmaModResourceIndexCtrl
 */
.controller('mmaModResourceIndexCtrl', function($scope, $stateParams, $mmUtil, $mmaModResource,
        $translate, $log, mmaModResourceComponent) {
    $log = $log.getInstance('mmaModResourceIndexCtrl');

    var module = $stateParams.module || {};

    $scope.title = module.name;
    $scope.description = module.description;
    $scope.component = mmaModResourceComponent;
    $scope.componentId = module.id;
    $scope.externalUrl = module.url;
    $scope.inlineContent = false;
    $scope.externalContent = false;
    $scope.loaded = false;

    function fetchContent() {
        if (module.contents) {
            if ($mmaModResource.isDisplayedInline(module)) {
                $mmaModResource.getResourceHtml(module.contents, module.id).then(function(content) {
                    $scope.externalContent = false;
                    $scope.inlineContent = true;
                    $scope.content = content;

                    $mmaModResource.logView(module.instance);
                }).catch(function() {
                    $mmUtil.showErrorModal('mma.mod_resource.errorwhileloadingthecontent', true);
                }).finally(function() {
                    $scope.loaded = true;
                });

            } else {
                $scope.loaded = true;
                $scope.externalContent = true;
                $scope.inlineContent = false;

                $scope.open = function() {
                    var modal = $mmUtil.showModalLoading('mm.core.downloading', true);

                    $mmaModResource.openFile(module.contents, module.id).then(function() {
                        $mmaModResource.logView(module.instance);
                    }).catch(function() {
                        modal.dismiss();
                        $mmUtil.showErrorModal('mma.mod_resource.errorwhileloadingthecontent', true);
                    }).finally(function() {
                        modal.dismiss();
                    });
                };
            }
        } else {
            $mmUtil.showErrorModal('mma.mod_resource.errorwhileloadingthecontent', true);
        }
    }


    // Event sent by the directive mmaModResourceHtmlLink when we click an HTML link.
    $scope.$on('mmaModResourceHtmlLinkClicked', function(e, target) {
        console.log(target);
        $scope.loaded = false;
        $mmaModResource.getResourceHtml(module.contents, module.id, target).then(function(content) {
            $scope.content = content;
        }).catch(function() {
            $mmUtil.showErrorModal('mma.mod_resource.errorwhileloadingthecontent', true);
        }).finally(function() {
            $scope.loaded = true;
        });
    });

    $scope.doRefresh = function() {
        showLoading = false;
        $mmaModResource.invalidateContent(module.id)
        .then(function() {
            return fetchContent();
        }).finally(function() {
            $scope.$broadcast('scroll.refreshComplete');
        });
    };

    fetchContent();
});
