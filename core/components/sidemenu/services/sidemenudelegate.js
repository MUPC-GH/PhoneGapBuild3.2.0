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

angular.module('mm.core.sidemenu')

/**
 * Service to interact with plugins to be shown in the side menu. Provides functions to register a plugin
 * and notify an update in the data.
 *
 * @module mm.core.sidemenu
 * @ngdoc service
 * @name $mmSideMenuDelegate
 */
.factory('$mmSideMenuDelegate', function($log) {

    var plugins = {},
        self = {},
        data,
        controllers = [];

    /**
     * Register a plugin to show in the side menu.
     *
     * @param  {String}   name     Name of the plugin.
     * @param  {Function} callback Function to call to get the plugin data. This function should return an object with:
     *                                 -icon: Icon to show in the menu item.
     *                                 -name: Plugin name.
     *                                 -state: sref to the plugin's main state (i.e. site.messages).
     *                                 -badge: Number to show next to the plugin (like new notifications number). Optional.
     */
    self.registerPlugin = function(name, callback) {
        $log.debug("Register plugin '"+name+"'");
        plugins[name] = callback;
    };

    /**
     * Update the plugin data stored in the delegate.
     *
     * @param  {String}   name     Name of the plugin.
     */
    self.updatePluginData = function(name) {
        $log.debug("Update plugin '"+name+"' data");
        data[name] = plugins[name]();
        // self.notifyControllers();
    };

    /**
     * Get the data of the registered plugins.
     *
     * @return {Object} Registered plugins data.
     */
    self.getData = function() {
        if (typeof(data) == 'undefined') {
            data = {};
            angular.forEach(plugins, function(callback, plugin) {
                self.updatePluginData(plugin);
            });
        }
        return data;
    }

    // self.on = function(callback) {
    //     controllers.push(callback);
    // }

    // self.notifyControllers = function() {
    //     angular.forEach(controllers, function(callback) {
    //         callback();
    //     });

    // }

    return self;
});
