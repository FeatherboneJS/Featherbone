/**
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
**/
/*jslint node, devel*/
(function (exports) {
    "use strict";

    const fs = require("fs");
    const f = require("../../common/core");

    function processProperties(feather, properties) {
        let keys = Object.keys(feather.properties);

        feather.required = [];

        keys.forEach(function (key) {
            let property = feather.properties[key];
            let newProperty;
            let primitives = Object.keys(f.types);
            let formats = Object.keys(f.formats);

            function props() {
                let obj = {};

                obj.id = {};
                obj.id.type = "string";

                property.type.properties.forEach(function (key) {
                    obj[key] = {};
                    // TODO: Figure out what type really is based
                    // on feather
                    obj[key].type = "string";
                });

                return obj;
            }

            // Bail if child property. Not necessary for api definition
            if (typeof property.type === "object" && property.type.childOf) {
                return;
            }

            newProperty = {};
            if (property.isRequired === true) {
                feather.required.push(key);
            }

            if (property.description) {
                newProperty.description = property.description;
            }

            if (typeof property.type === "object") {
                newProperty.type = (
                    property.type.parentOf
                    ? "array"
                    : "object"
                );

                if (newProperty.type === "object") {
                    newProperty.required = ["id"];
                    newProperty.properties = props();
                } else {
                    newProperty.items = {
                        "$ref": (
                            "#/components/schemas/" +
                            property.type.relation
                        )
                    };
                }
            } else {
                if (primitives.indexOf(property.type) !== -1) {
                    newProperty.type = property.type;
                } else {
                    throw new Error(
                        "Property type " + property.type +
                        " not supported on " + key + " for feather " +
                        feather.name
                    );
                }

                if (property.format) {
                    if (formats.indexOf(property.format) !== -1) {
                        newProperty.format = property.format.toSpinalCase();
                    } else {
                        throw new Error(
                            "Property format " + property.format +
                            " not supported on " + key + " for feather " +
                            feather.name
                        );
                    }
                }
            }

            properties[key] = newProperty;
        });
    }

    exports.API = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
          Build open api specification.

          @param {Object} Datasource
          @return {Object} Promise
        */
        that.build = function (datasource) {
            return new Promise(function (resolve, reject) {
                let api;
                let catalog;
                let payload;
                let keys;
                let name;
                let path;
                let tags = [];

                function callback(resp) {
                    let schemas = api.components.schemas;

                    catalog = resp;

                    // Loop through each feather and append to api api
                    keys = Object.keys(catalog);
                    keys.sort(function (a, b) {
                        return (
                            a < b
                            ? -1
                            : 1
                        );
                    });

                    keys.forEach(function (key) {
                        name = key.toProperCase();

                        let schema;
                        let feather = catalog[key];
                        let properties = {};
                        let inherits = feather.inherits || "Object";
                        let tag = key.toSpinalCase();
                        let pathName = "/data/" + tag + "/{id}";
                        let expResp = {
                            "$ref": "#/components/schemas/" + key
                        };
                        let errResp = {
                            "$ref": "#/components/schemas/ErrorResponse"
                        };
                        let patchDef = {
                            tags: [tag],
                            summary: "Update an existing " + name,
                            operationId: "doPatch" + name,
                            parameters: [
                                {
                                    "name": "id",
                                    "in": "path",
                                    "description": (
                                        "The id of the " + name +
                                        " to update"
                                    ),
                                    "required": true,
                                    "schema": {
                                        "type": "string"
                                    }
                                }
                            ],
                            requestBody: {
                                $ref: "#/components/requestBodies/JSONPatch"
                            },
                            responses: {
                                "200": {
                                    "description": (
                                        "Expected response to a valid request"
                                    ),
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": (
                                                    "#/components/" +
                                                    "schemas/JSONPatch"
                                                )
                                            }
                                        }
                                    }
                                },
                                "default": {
                                    "description": "Unexpected error",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": (
                                                    "#/components/" +
                                                    "schemas/ErrorResponse"
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        let deleteDef = {
                            tags: [tag],
                            summary: "Delete a " + name,
                            operationId: "doDelete" + name,
                            parameters: [
                                {
                                    "name": "id",
                                    "in": "path",
                                    "description": (
                                        "The id of the " + name +
                                        " to delete"
                                    ),
                                    "required": true,
                                    "schema": {
                                        "type": "string"
                                    }
                                }
                            ],
                            responses: {
                                "200": {
                                    "description": (
                                        "Boolean indicating succesful deletion"
                                    ),
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "boolean"
                                            }
                                        }
                                    }
                                },
                                "default": {
                                    "description": "Unexpected error",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": (
                                                    "#/components/" +
                                                    "schemas/ErrorResponse"
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        let postDef = {
                            tags: [tag],
                            summary: "Add a new " + name + " to the database",
                            operationId: "doInsert" + name,
                            requestBody: {
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "$ref": (
                                                "#/components/schemas/" + key
                                            )
                                        }
                                    }
                                }
                            },
                            responses: {
                                "200": {
                                    "description": (
                                        "Patch list of differences applied" +
                                        "by the server to the request"
                                    ),
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": (
                                                    "#/components/" +
                                                    "schemas/JSONPatch"
                                                )
                                            }
                                        }
                                    }
                                },
                                "default": {
                                    "description": "Unexpected error",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": (
                                                    "#/components/" +
                                                    "schemas/ErrorResponse"
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        let queryPostDef = {
                            post: {
                                tags: [tag],
                                summary: "Query " + key + " data",
                                operationId: "doSelect" + name,
                                requestBody: {
                                    $ref: "#/components/requestBodies/Query"
                                },
                                responses: {
                                    "200": {
                                        "description": (
                                            feather.plural
                                            ? (
                                                "Array of " +
                                                feather.plural.toProperCase()
                                            )
                                            : ""
                                        ),
                                        "content": {
                                            "application/json": {
                                                "schema": {
                                                    "$ref": (
                                                        "#/components/" +
                                                        "schemas/" + key
                                                    )
                                                }
                                            }
                                        }
                                    },
                                    "default": {
                                        "description": "Unexpected error",
                                        "content": {
                                            "application/json": {
                                                "schema": {
                                                    "$ref": (
                                                        "#/components/" +
                                                        "schemas/ErrorResponse"
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        };

                        // Append singluar path
                        if (!feather.isChild) {
                            tags.push({
                                name: tag,
                                description: key + " data"
                            });

                            path = {
                                get: {
                                    tags: [tag],
                                    summary: "Info for a specific " + name,
                                    parameters: [
                                        {
                                            "name": "id",
                                            "in": "path",
                                            "description": (
                                                "The id of the " +
                                                name + " to retrieve"
                                            ),
                                            "required": true,
                                            "schema": {
                                                "type": "string"
                                            }
                                        }
                                    ],
                                    responses: {
                                        "200": {
                                            "description": (
                                                "Expected response to a " +
                                                "valid request"
                                            ),
                                            "content": {
                                                "application/json": {
                                                    "schema": expResp
                                                }
                                            }
                                        },
                                        "default": {
                                            "description": "Unexpected error",
                                            "content": {
                                                "application/json": {
                                                    "schema": errResp
                                                }
                                            }
                                        }
                                    }
                                }
                            };

                            if (feather.readOnly !== true) {
                                path.patch = patchDef;
                                path.delete = deleteDef;
                            }

                            api.paths[pathName] = path;

                            if (feather.readOnly !== true) {
                                path = {};
                                path.post = postDef;
                                api.components.requestBodies[key] = {
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "$ref": (
                                                    "#/components/schemas/" +
                                                    key
                                                )
                                            }
                                        }
                                    },
                                    "description": name + " to be added",
                                    "required": true
                                };

                                pathName = "/data/" + key.toSpinalCase();
                                api.paths[pathName] = path;
                            }

                            // Append list path
                            if (feather.plural) {
                                path = queryPostDef;

                                pathName = (
                                    "/data/" + feather.plural.toSpinalCase()
                                );
                                api.paths[pathName] = path;
                            }
                        }
                        // Append singular feather definition
                        schema = {};

                        if (feather.description) {
                            schema.description = feather.description;
                        }

                        if (feather.discriminator) {
                            schema.discriminator = feather.discriminator;
                        }

                        processProperties(feather, properties);

                        if (key === "Object") {
                            delete schema.discriminator;
                            schema.type = "object";
                            schema.properties = properties;
                        } else {
                            schema.allOf = [{
                                $ref: "#/components/schemas/" + inherits
                            }];

                            if (Object.keys(properties).length) {
                                schema.allOf.push({
                                    properties: properties
                                });
                            }
                        }

                        if (feather.required.length) {
                            schema.required = feather.required;
                        }

                        schemas[key] = schema;
                    });

                    tags.sort(function (a, b) {
                        return (
                            a.name < b.name
                            ? -1
                            : 1
                        );
                    });

                    api.tags = api.tags.concat(tags);

                    api = JSON.stringify(api, null, 4);

                    // Save api file
                    fs.writeFile("./api.json", api, function (err) {
                        if (err) {
                            console.error(err);
                            return;
                        }
                        resolve();
                    });
                }

                // Real work starts here
                console.log("Building Open API specification");

                // Load the baseline api file
                fs.readFile("./server/api-base.json", "utf8", function (
                    err,
                    data
                ) {
                    if (err) {
                        console.error(err);
                        return;
                    }

                    api = JSON.parse(data);

                    // Load the existing feather catalog from postgres
                    payload = {
                        method: "GET",
                        name: "getSettings",
                        user: datasource.getCurrentUser(),
                        data: {
                            name: "catalog"
                        }
                    };

                    datasource.request(payload, true).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            });
        };

        return that;
    };

}(exports));