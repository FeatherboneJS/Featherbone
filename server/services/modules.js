/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/
/*global Promise*/
/*jslint node, es6*/
(function (exports) {
    "strict";

    const {
        Tools
    } = require('./tools');

    const tools = new Tools();

    exports.Modules = function () {
        // ..........................................................
        // PUBLIC
        //

        var that = {};

        /**
          Return routes.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @return {Object}
        */
        that.getModules = function (obj) {
            return new Promise(function (resolve, reject) {
                var sql = "SELECT * FROM \"$module\";";

                // Query routes
                obj.client.query(sql, function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(tools.sanitize(resp.rows));
                });
            });
        };

        return that;
    };

}(exports));
