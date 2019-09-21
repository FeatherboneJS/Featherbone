/*
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
*/
/*jslint node*/
/**
    @module Role
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const db = new Database();

    /**
        @class Role
        @constructor
        @namespace Services
    */
    exports.Role = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Used for user to update their own password. Requires both
            old password and new password.
            @method changeOwnPassword
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Data
            @param {String} payload.data.name Role name
            @param {String} payload.data.oldPassword Old password
            @param {String} payload.data.newPassword New password
            @return {Promise}
        */
        that.changeOwnPassword = function (obj) {
            return new Promise(function (resolve, reject) {
                function callback() {
                    that.changeRolePassword({
                        client: obj.client,
                        data: {
                            name: obj.data.name,
                            password: obj.data.newPassword
                        }
                    }).then(resolve).catch(reject);
                }

                if (obj.data.oldPassword === obj.data.newPassword) {
                    throw new Error(
                        "New password can not be the same as old password"
                    );
                }

                if (!obj.data.newPassword) {
                    throw new Error("New password can not be blank");
                }

                db.authenticate(
                    obj.data.name,
                    obj.data.oldPassword
                ).then(callback).catch(reject);
            });
        };

        /**
            Update whether role can log in.
            @method changeRoleLogin
            @param {Object} Payload
            @param {Client} [payload.client]
            @param {Object} [payload.data] Data
            @param {String} [payload.data.name] Role name
            @param {Boolean} [payload.data.isLogin] Is Login
            @return {Promise}
        */
        that.changeRoleLogin = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "ALTER ROLE %I " + (
                    obj.data.isLogin === true
                    ? "LOGIN"
                    : "NOLOGIN"
                ) + ";";
                let client = db.getClient(obj.client);

                sql = sql.format([name]);
                client.query(sql, function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(true);
                });
            });
        };

        /**
            Update role password.
            @method changeRolePassword
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Data
            @param {String} payload.data.name Role name
            @param {String} payload.data.password Password
            @return {Promise}
        */
        that.changeRolePassword = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let pwd = obj.data.password;
                let sql = "ALTER ROLE %I PASSWORD %L;";
                let client = db.getClient(obj.client);

                sql = sql.format([name, pwd]);
                client.query(sql, function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(true);
                });
            });
        };

        /**
            Create role with password.
            @method createRole
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.name Role name
            @param {String} payload.data.password Password
            @param {Boolean} [payload.data.isLogin] Default false
            @param {Boolean} [payload.data.isInherit] Default false
            @return {Promise}
        */
        that.createRole = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let pwd = obj.data.password;
                let sql = (
                    "SELECT * FROM pg_catalog.pg_roles " +
                    "WHERE rolname = $1;"
                );
                let client = db.getClient(obj.client);

                client.query(sql, [name]).then(function (resp) {
                    if (!resp.rows.length) {
                        sql = "CREATE ROLE %I " + (
                            obj.data.isLogin === true
                            ? "LOGIN"
                            : "NOLOGIN"
                        ) + (
                            obj.data.isInherit !== false
                            ? " INHERIT "
                            : " NOINHERIT "
                        ) + " PASSWORD %L;";

                        sql = sql.format([name, pwd]);
                        client.query(sql, function (err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            // Send back result
                            resolve(true);
                        });
                    } else {
                        that.changeRoleLogin(obj).then(
                            that.changeRolePassword.bind(null, obj)
                        ).then(resolve).catch(reject);
                    }
                });
            });
        };

        /**
            Drop role.
            @method dropRole
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.name Role name
            @return {Promise}
        */
        that.dropRole = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "DROP ROLE %I;";
                let client = db.getClient(obj.client);

                function callback() {
                    client.query(
                        "DELETE FROM \"$auth\" WHERE role=$1;",
                        [name]
                    ).then(resolve).catch(reject);
                }

                sql = sql.format([name]);
                client.query(sql).then(callback).catch(reject);
            });
        };

        /**
            Grant one user or role privileges to another role.
            @method grantMembership
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.fromRole
            @param {Boolean} payload.data.toRole
            @return {Promise}
        */
        that.grantMembership = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "GRANT %I TO %I;";
                let client = db.getClient(obj.client);

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                client.query(sql).then(resolve).catch(reject);
            });
        };

        /**
            Revoke one user or role privileges from another role.
            @method revokeMembership
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.fromRole
            @param {Boolean} payload.data.toRole
            @return {Promise}
        */
        that.revokeMembership = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "REVOKE %I FROM %I;";
                let client = db.getClient(obj.client);

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                client.query(sql).then(resolve).catch(reject);
            });
        };

        return that;
    };

}(exports));

