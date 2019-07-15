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
    @module Packager
*/
(function (exports) {
    "use strict";

    const AdmZip = require("adm-zip");
    const path = require("path");
    const {
        Tools
    } = require("./tools");
    const propExclusions = [
        "id",
        "lock",
        "isDeleted",
        "created",
        "createdBy",
        "updated",
        "updatedBy",
        "objectType"
    ];
    const propTypes = [
        "description",
        "alias",
        "type",
        "format",
        "scale",
        "precision",
        "min",
        "max",
        "default",
        "autonumber",
        "isReadOnly",
        "isRequired",
        "isNaturalKey",
        "isLabelKey",
        "dataList",
        "isIndexed"
    ];

    const tools = new Tools();

    function getSortedModules(client, name) {
        return new Promise(function (resolve, reject) {
            let theOne;
            let sql = (
                "SELECT name, version, script, " +
                "to_json(dependencies) AS dependencies " +
                "FROM _module;"
            );

            function callback(resp) {
                let modules = resp.rows;

                function resolveDependencies(module, tree) {
                    tree = tree || module.tree;

                    module.tree.forEach(function (dependency) {
                        let parent = modules.find(
                            (module) => module.name === dependency
                        );

                        parent.tree.forEach(
                            (pDepencency) => tree.push(pDepencency)
                        );

                        resolveDependencies(parent, tree);
                    });
                }

                // Simplify dependencies
                modules.forEach(function (module) {
                    module.dependencies = module.dependencies.map(
                        (dep) => dep.module.name
                    );
                    module.tree = module.dependencies.slice();
                });

                // Process modules, start by resolving,
                // then sorting on dependencies
                modules.forEach((module) => resolveDependencies(module));

                // Filter to only modules related to the one being packaged
                theOne = modules.find((module) => module.name === name);

                modules = modules.filter(function (module) {
                    return (
                        module.name === name ||
                        theOne.tree.indexOf(module.name) !== -1
                    );
                });

                // Sort
                modules = (function () {
                    let module;
                    let idx;
                    let ret = [];

                    function top(mod) {
                        return mod.tree.every(
                            (dep) => ret.some((added) => added.name === dep)
                        );
                    }

                    while (modules.length) {
                        module = modules.find(top);

                        ret.push(module);
                        idx = modules.indexOf(module);
                        modules.splice(idx, 1);
                    }

                    return ret;
                }());

                // Never package core
                modules = modules.filter((module) => module.name !== "Core");

                resolve(modules);
            }

            client.query(sql).then(callback).catch(reject);
        });
    }

    function removeExclusions(row) {
        Object.keys(row).forEach(function (key) {
            if (propExclusions.indexOf(key) !== -1) {
                delete row[key];
            } else if (Array.isArray(row[key])) {
                row[key].forEach(removeExclusions);
            }
        });
    }

    function addModule(manifest, zip, resp, folder) {
        let content;
        let filename = folder + "module.js";

        content = resp.slice().pop();

        manifest.module = content.name;
        manifest.version = content.version;
        manifest.dependencies = content.dependencies;
        manifest.files.push({
            type: "module",
            path: "module.js"
        });

        zip.addFile(
            filename,
            Buffer.alloc(content.script.length, content.script)
        );
    }

    function addFeathers(manifest, zip, resp, folder) {
        let content;
        let filename = folder + "feathers.json";

        content = tools.sanitize(resp.rows);
        content.forEach(function (feather) {
            let props = {};

            feather.properties.forEach(function (prop) {

                props[prop.name] = prop;

                // Remove unnecessary properties
                Object.keys(prop).forEach(function (key) {
                    if (propTypes.indexOf(key) === -1) {
                        delete prop[key];
                    }
                });

                // Remove noise
                if (
                    prop.type === "number" ||
                    prop.type === "integer"
                ) {
                    if (prop.scale === -1) {
                        delete prop.scale;
                    }

                    if (prop.precision === -1) {
                        delete prop.precision;
                    }

                    if (prop.min === 0) {
                        delete prop.min;
                    }

                    if (prop.max === 0) {
                        delete prop.max;
                    }
                } else {
                    delete prop.scale;
                    delete prop.precision;
                    delete prop.min;
                    delete prop.max;
                }

                if (prop.format === "") {
                    delete prop.format;
                }

                if (prop.alias === "") {
                    delete prop.alias;
                }

                if (prop.autonumber === null) {
                    delete prop.autonumber;
                }

                if (prop.isNaturalKey === false) {
                    delete prop.isNaturalKey;
                }

                if (prop.isLabelKey === false) {
                    delete prop.isLabelKey;
                }

                if (prop.isRequired === false) {
                    delete prop.isRequired;
                }

                if (prop.isReadOnly === false) {
                    delete prop.isReadOnly;
                }

                if (prop.isIndexed === false) {
                    delete prop.isIndexed;
                }

                if (prop.dataList === null) {
                    delete prop.dataList;
                }

                if (
                    prop.default === null &&
                    prop.format !== "date" &&
                    prop.format !== "dateTime"
                ) {
                    delete prop.default;
                }
            });

            if (Object.keys(props).length) {
                feather.properties = props;
            } else {
                delete feather.properties;
            }

            props = {};
            feather.overloads.forEach(function (o) {
                let overload = {};

                if (o.overloadDescription) {
                    overload.description = o.description;
                }

                if (o.overloadAlias) {
                    overload.alias = o.alias;
                }

                if (o.overloadType) {
                    overload.type = o.type;
                }

                if (o.overloadDefault) {
                    overload.default = o.default;
                }

                if (o.overloadDataList) {
                    overload.dataList = o.dataList;
                }

                props[overload.name] = overload;
            });

            if (Object.keys(props).length) {
                feather.overloads = props;
            } else {
                delete feather.overloads;
            }

            if (feather.isReadOnly === false) {
                delete feather.isReadOnly;
            }

            if (feather.isFetchOnStartup === false) {
                delete feather.isFetchOnStartup;
            }

            if (feather.authorization === null) {
                delete feather.authorization;
            }

            if (feather.plural === "") {
                delete feather.plural;
            }

            if (feather.isChild === false) {
                delete feather.isChild;
            }

            if (feather.isSystem === false) {
                delete feather.isSystem;
            }

            feather.dependencies = [];
            if (feather.inherits) {
                feather.dependencies.push(feather.inherits);
            }
        });

        // Determine feather's full inheritence dependencies
        function resolveDependencies(feather, dependencies) {
            dependencies = dependencies || feather.dependencies;

            feather.dependencies.forEach(function (dependency) {
                let parent = content.find(
                    (feather) => feather.name === dependency
                );

                if (parent) {
                    parent.dependencies.forEach(
                        (pDepencency) => dependencies.push(pDepencency)
                    );

                    resolveDependencies(parent, dependencies);
                }
            });
        }

        // Process feathers, start by sorting alpha and relation
        // dependencies, then inheritence
        content.sort(function (a, b) {
            function withB(key) {
                let p = a.properties[key];

                return (
                    typeof p.type === "object" &&
                    p.type.relation === b.name
                );
            }

            function withA(key) {
                let p = b.properties[key];

                return (
                    typeof p.type === "object" &&
                    p.type.relation === a.name
                );
            }

            if (
                a.properties &&
                Object.keys(a.properties).some(withB)
            ) {
                return 1;
            }

            if (
                b.properties &&
                Object.keys(b.properties).some(withA)
            ) {
                return -1;
            }

            if (a.name > b.name) {
                return 1;
            }

            return -1;
        });
        content.forEach((feather) => resolveDependencies(feather));
        content = (function () {
            let feather;
            let idx;
            let ret = [];
            let outsider = [];

            // See if every feather instance is already
            // accounted for
            function top(instance) {
                return instance.dependencies.every(function (dep) {
                    return (
                        ret.some((added) => added.name === dep) ||
                        outsider.indexOf(dep) > -1
                    );
                });
            }

            // Discount parents from other packages
            content.forEach(function (feather) {
                let parent = feather.inherits;

                function isParent(instance) {
                    return instance.name === parent;
                }

                if (!content.some(isParent)) {
                    outsider.push(feather.inherits);
                }
            });

            while (content.length) {
                feather = content.find(top);

                ret.push(feather);
                idx = content.indexOf(feather);
                content.splice(idx, 1);
            }

            return ret;
        }());

        // Now can remove dependency info
        content.forEach(function (feather) {
            delete feather.dependencies;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "feather",
                path: "feathers.json"
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addForms(manifest, zip, resp, folder) {
        let content = [];
        let rows = tools.sanitize(resp.rows);
        let filename = folder + "forms.json";

        content = rows.map(function (row) {
            let data = row.form;
            let ret = {
                name: "Form",
                method: "POST",
                module: data.module,
                id: data.id,
                data: data
            };

            if (!data.focus) {
                delete data.focus;
            }
            removeExclusions(data);
            data.attrs.forEach(function (attr) {
                if (!attr.label) {
                    delete attr.label;
                }

                if (!attr.columns.length) {
                    delete attr.columns;
                } else {
                    attr.columns.forEach(function (col) {
                        if (!col.filter) {
                            delete col.filter;
                        }

                        if (!col.showCurrency) {
                            delete col.showCurrency;
                        }

                        if (!col.width) {
                            delete col.width;
                        }

                        if (!col.dataList) {
                            delete col.dataList;
                        }

                        if (!col.label) {
                            delete col.label;
                        }
                    });
                }

                if (!attr.dataList) {
                    delete attr.dataList;
                }

                if (!attr.disableCurrency) {
                    delete attr.disableCurrency;
                }

                if (!attr.relationWidget) {
                    delete attr.relationWidget;
                }

                if (!attr.filter) {
                    delete attr.filter;
                }

                if (attr.showLabel) {
                    delete attr.showLabel;
                }
            });

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: "forms.json"
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addServices(manifest, zip, resp, folder) {
        let content = resp.rows;

        if (content.length) {
            content.forEach(function (service) {
                let name = service.name.toSpinalCase() + ".js";
                let filename = folder + name;

                manifest.files.push({
                    type: "service",
                    name: service.name,
                    path: name
                });

                zip.addFile(
                    filename,
                    Buffer.alloc(service.script.length, service.script)
                );
            });
        }
    }

    function addWorkbooks(manifest, zip, resp, folder) {
        let content = tools.sanitize(resp.rows);
        let name = "workbooks.json";
        let filename = folder + name;

        content.forEach(function (workbook) {
            removeExclusions(workbook);
            if (workbook.localConfig.length) {
                workbook.defaultConfig = workbook.localConfig;
            }

            delete workbook.localConfig;

            if (!Object.keys(workbook.launchConfig).length) {
                delete workbook.launchConfig;
            }
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "workbook",
                path: name
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addBatch(type, manifest, zip, resp, folder) {
        let content = [];
        let rows = tools.sanitize(resp.rows);
        let name = type.toCamelCase() + "s.json";
        let filename = folder + name;

        content = rows.map(function (data) {
            let ret = {
                name: type,
                method: "POST",
                module: data.module,
                id: data.id,
                data: data
            };

            if (!data.focus) {
                delete data.focus;
            }
            removeExclusions(data);

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: name
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    exports.Packager = function () {
        // ..........................................................
        // PUBLIC
        //

        /**
            @class Packager
            @constructor
            @namespace Services
        */
        let that = {};

        function addDependencies(client, manifest, zip, resp, user, folder) {
            return new Promise(function (resolve, reject) {
                let content;
                let requests = [];

                if (!resp.length) {
                    throw "Module not found";
                }

                content = resp.slice(0, resp.length - 1);

                content.forEach(function (module) {
                    let name = module.name;
                    let addPackage;

                    addPackage = new Promise(function (resolve, reject) {
                        function callback() {
                            manifest.dependencies.push(name);
                            manifest.files.push({
                                type: "install",
                                path: name.toSpinalCase() + "/manifest.json"
                            });

                            resolve();
                        }

                        that.package(
                            client,
                            name,
                            user,
                            {
                                zip: zip,
                                folder: folder + name.toSpinalCase() + "/",
                                module: module
                            }
                        ).then(callback).catch(reject);
                    });

                    requests.push(addPackage);
                });

                Promise.all(requests).then(resolve).catch(reject);
            });
        }

        /**
            Package a module and its submodules into a zip file.

            @method package
            @param {Client} client Database client
            @param {String} name Module name
            @param {String} user User name
            @param {Object} [sub] Sub module
            @return {Promise}
        */
        that.package = function (client, name, user, sub) {
            sub = sub || {};

            return new Promise(function (resolve, reject) {
                let sql;
                let params = [name];
                let requests = [];
                let manifest = {
                    module: "",
                    version: "",
                    dependencies: [],
                    files: []
                };
                let zip = sub.zip || new AdmZip();
                let folder = sub.folder || "";

                if (folder) {
                    // Create folder for sub module
                    zip.addFile(folder, Buffer.alloc(0, null));
                }

                // Module
                if (!sub.module) {
                    requests.push(getSortedModules(client, name));
                } else {
                    requests.push(Promise.resolve);
                }

                // Feathers
                sql = (
                    "SELECT name, description, plural, \"module\", " +
                    "\"authorization\", \"inherits\", is_system, is_child, " +
                    "is_fetch_on_startup, is_read_only, " +
                    "to_json(properties) AS properties, " +
                    "to_json(overloads) AS overloads " +
                    "FROM _feather WHERE module = $1" +
                    " AND NOT is_deleted;"
                );
                requests.push(client.query(sql, params));

                // Forms
                sql = (
                    "SELECT to_json(_form) AS form " +
                    "FROM _form WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name"
                );
                requests.push(client.query(sql, params));

                // Services
                sql = (
                    "SELECT name, script " +
                    "FROM data_service WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Routes
                sql = (
                    "SELECT * FROM route WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY path;"
                );
                requests.push(client.query(sql, params));

                // Styles
                sql = (
                    "SELECT * FROM style WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Workbooks
                sql = (
                    "SELECT * FROM \"$workbook\" WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                Promise.all(requests).then(function (resp) {
                    let filename = name;
                    let pathname = path.format({
                        root: "./",
                        base: "files/downloads/"
                    });

                    function finishPackage() {
                        addFeathers(manifest, zip, resp[1], folder);
                        addForms(manifest, zip, resp[2], folder);
                        addServices(manifest, zip, resp[3], folder);
                        addBatch("Route", manifest, zip, resp[4], folder);
                        addBatch("Style", manifest, zip, resp[5], folder);
                        addWorkbooks(manifest, zip, resp[6], folder);
                        if (sub.module) {
                            addModule(manifest, zip, [sub.module], folder);
                        } else {
                            addModule(manifest, zip, resp[0], folder);
                        }

                        if (manifest.version) {
                            filename += "-v" + manifest.version;
                        }

                        manifest = JSON.stringify(manifest, null, 4);

                        zip.addFile(
                            folder + "manifest.json",
                            Buffer.alloc(manifest.length, manifest)
                        );

                        // Only write zip out the top level
                        if (folder) {
                            resolve();
                        } else {
                            filename += ".zip";
                            zip.writeZip(
                                pathname + filename,
                                resolve.bind(null, filename)
                            );
                        }
                    }

                    if (sub.module) {
                        finishPackage();
                    } else {
                        addDependencies(
                            client,
                            manifest,
                            zip,
                            resp[0],
                            user,
                            folder
                        ).then(finishPackage).catch(reject);
                    }
                }).catch(reject);
            });
        };

        return that;
    };

}(exports));

