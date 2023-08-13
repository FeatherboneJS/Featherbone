/*
    Framework for building object relational database apps
    Copyright (C) 2023  John Rogelstad

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
/*jslint node, this, eval, unordered */
(function () {
    "use strict";
    require("./common/string.js");

    const datasource = require("./server/datasource");
    const express = require("express");
    const session = require("express-session");
    const PgSession = require("connect-pg-simple")(session);
    const expressFileUpload = require("express-fileupload");
    const fs = require("fs");
    const bodyParser = require("body-parser");
    const f = require("./common/core");
    const qs = require("qs");
    const AdmZip = require("adm-zip");
    const path = require("path");
    const passport = require("passport");
    const LocalStrategy = require("passport-local").Strategy;
    const authenticate = passport.authenticate("local", {
        failureFlash: "Username or password invalid",
        failWithError: true
    });
    const {Config} = require("./server/config");
    const config = new Config();
    const {Tools} = require("./server/services/tools");
    const WebSocket = require("ws");
    const wss = new WebSocket.Server({noServer: true});
    const pdf = require("./server/services/pdf.js");
    const {webauthn} = require("./server/services/webauthn");
    const dbRouter = new express.Router();

    const check = [
        "data",
        "do",
        "feather",
        "module",
        "modules",
        "profile",
        "settings",
        "settings-definition",
        "workbook",
        "workbooks"
    ];
    const winston = require("winston");
    require("winston-daily-rotate-file");
    const argv = process.argv;
    let loglevel;
    let consolelog;
    let debug;

    argv.forEach(function (arg) {
        switch (arg) {
        case "--loglevel":
            loglevel = argv[argv.indexOf("--loglevel") + 1];
            break;
        case "-L":
            loglevel = argv[argv.indexOf("-L") + 1];
            break;
        case "--consolelog":
        case "-C":
            consolelog = true;
            break;
        }
    });

    /**
        @property datasource
        @type Datasource
        @for f
        @final
    */
    f.datasource = datasource;
    /**
        Fast json patch library per API documented here:
        https://github.com/Starcounter-Jack/JSON-Patch#api
        @property jsonpatch
        @type Object
        @for f
        @final
    */
    f.jsonpatch = require("fast-json-patch");

    /**
        @property formats
        @type Object
        @for f
        @final
    */
    f.formats = new Tools().formats;

    let app = express();
    let routes = [];
    let eventSessions = {};
    let eventKeys = {};
    let sessions = {};
    let fileUpload = false;
    let port;
    let mode;
    let settings = datasource.settings();
    let dir = "./files";
    let pgPool;
    let sessionTimeout;
    let thesecret;
    let systemUser;
    let logger;
    let tenants = false;

    // Work around linter dogma
    let existssync = "existsSync";
    let lstatsync = "lstatSync";
    let unlinksync = "unlinkSync";
    let readdirsync = "readdirSync";
    let mkdirsync = "mkdirSync";
    let rmdirsync = "rmdirSync";

    // Make sure file directories exist
    dir = "./files/import";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./files/upload";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./files/downloads";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./logs";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    /**
        Remove directory recursively.
        https://stackoverflow.com/a/42505874/3027390

        @method rimraf
        @param {string} dir_path
    */
    function rimraf(dir_path) {
        // Linter really hates "sync" methods
        if (fs[existssync](dir_path)) {
            fs[readdirsync](dir_path).forEach(function (entry) {
                let entry_path = path.join(dir_path, entry);

                if (fs[lstatsync](entry_path).isDirectory()) {
                    rimraf(entry_path);
                } else {
                    fs[unlinksync](entry_path);
                }
            });
            fs[rmdirsync](dir_path);
        }
    }

    // Handle response
    function respond(resp) {
        if (resp === undefined) {
            this.statusCode = 204;
        }

        // No caching... ever
        this.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        this.setHeader("Pragma", "no-cache"); // HTTP 1.0.
        this.setHeader("Expires", "0");

        // Send back a JSON response
        this.json(resp);
    }

    // Handle datasource error
    function error(err) {
        if (typeof err === "string") {
            err = new Error(err);
        }
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        logger.error(err.message);
        this.status(err.statusCode).json(err.message);
        datasource.getCatalog().catch(function (e) {
            console.log(e);
        });
    }

    async function init() {
        try {
            // Configure logger
            let resp = await config.read();
            let log = {
                level: resp.logLevel,
                zippedArchive: resp.logZippedArchive,
                maxSize: resp.logMaxSize,
                maxFiles: resp.logMaxFiles,
                silent: resp.logSilent
            };
            let fmt = winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            );

            logger = winston.createLogger({
                format: fmt,
                level: loglevel || log.level || "info",
                transports: [],
                silent: Boolean(log.silent)
            });

            if (consolelog) {
                logger.add(new winston.transports.Console({
                    format: winston.format.prettyPrint()
                }));
            }

            logger.add(
                new(winston.transports.DailyRotateFile)({
                    format: fmt,
                    filename: "./logs/featherbone-%DATE%.log",
                    datePattern: "YYYY-MM-DD-HH",
                    zippedArchive: Boolean(log.zippedArchive),
                    maxSize: log.maxSize || "20m",
                    maxFiles: log.maxFiles || "7d"
                })
            );

            logger.info("Featherbone server starting");

            // Other config
            debug = Boolean(resp.debug);

            // Default 1 day.
            sessionTimeout = resp.sessionTimeout || 86400000;
            thesecret = resp.secret;
            systemUser = resp.pgUser;
            mode = resp.mode || "prod";
            port = process.env.PORT || resp.clientPort || 80;
            fileUpload = Boolean(resp.fileUpload);

            await datasource.loadCryptoKey();
            await datasource.getCatalog();
            routes = await datasource.getRoutes();
            await datasource.unlock();
            pgPool = await datasource.getPool();
            await datasource.loadNpmModules();
            await datasource.loadServices();
            tenants = await datasource.loadTenants();
            await datasource.cleanupProcesses();
            await datasource.unsubscribe();

            webauthn.loadCipher(process.env.CIPHER || resp.cipher);
            webauthn.init(
                (process.env.RPID || resp.rpId || "localhost"),
                (process.env.ORIGIN || resp.origin || "http://localhost")
            );

        } catch (err) {
            logger.error(err.message);
            console.log(err);
        }
    }

    function resolveName(apiPath) {
        //  Remove database from path
        apiPath = apiPath.slice(1);
        apiPath = apiPath.slice(apiPath.indexOf("/"));
        // Also remove verb
        apiPath = apiPath.slice(1);
        apiPath = apiPath.slice(apiPath.indexOf("/"));

        let name;
        let keys;
        let found;
        let catalog = settings.data.catalog.data;

        if (apiPath.lastIndexOf("/") > 0) {
            name = apiPath.match("[/](.*)[/]")[1].toCamelCase(true);
        } else {
            name = apiPath.slice(1).toCamelCase(true);
        }

        if (catalog) {
            // Look for feather with same name
            if (catalog[name]) {
                return name;
            }

            // Look for plural version
            keys = Object.keys(catalog);
            found = keys.filter(function (key) {
                return catalog[key].plural === name;
            });

            if (found.length) {
                return found[0];
            }

            return;
        }
    }

    function postify(req, res) {
        let payload = {
            method: "POST",
            name: this,
            user: req.user.name,
            data: req.body,
            tenant: false
        };

        logger.info(payload);
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function registerRoute(route) {
        let fullPath = (
            "/:db/" +
            route.module.toSpinalCase() + route.path
        );
        let doPostRequest = postify.bind(route.function);

        logger.info("Registering module route: " + fullPath);
        dbRouter.post(fullPath, doPostRequest);
    }

    function doRequest(req, res) {
        let payload = {
            name: resolveName(req.url),
            method: req.method,
            user: req.user.name,
            eventKey: req.query.eventKey,
            id: req.params.id,
            data: req.body || {},
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doPostUserAccount(req, res) {
        let payload = {
            name: "UserAccount",
            method: "POST",
            user: req.user.name,
            eventKey: req.eventKey,
            id: req.params.id,
            data: req.body || {},
            tenant: req.tenant
        };
        let log = f.copy(payload);
        log.data.password = "****";

        logger.verbose(log);
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doPatchUserAccount(req, res) {
        let payload = {
            name: "UserAccount",
            method: "PATCH",
            user: req.user.name,
            eventKey: req.query.eventKey,
            id: req.params.id,
            data: req.body || [],
            tenant: req.tenant
        };
        let log = f.copy(payload);
        log.data.forEach(function (item) {
            if (item.path === "/password") {
                item.value = "****";
            }
        });
        log.data.password = "****";

        logger.verbose(log);
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doQueryRequest(req, res) {
        let payload = req.body || {};
        let name = resolveName(req.url);
        let isSuper = (
            req.user.isSuper ||
            name === "Form" ||
            name === "Module" ||
            name === "Role" ||
            name === "UserAccount"
        );

        payload.name = name;
        payload.method = "GET"; // Internally this is a select statement
        payload.user = req.user.name;
        payload.filter = payload.filter || {};
        payload.tenant = req.tenant;

        if (payload.showDeleted) {
            payload.showDeleted = (
                payload.showDeleted === "true" || payload.showDeleted === true
            );
        }

        if (payload.subscription !== undefined) {
            payload.subscription.merge = (
                payload.subscription.merge === "true" ||
                payload.subscription.merge === true
            );
        }

        payload.filter.offset = payload.filter.offset || 0;

        logger.verbose(payload);
        datasource.request(payload, isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doAggregate(req, res) {
        let payload = {
            method: "POST",
            name: "doAggregate",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doGetMethod(fn, req, res) {
        let payload = {
            method: "GET",
            name: fn,
            user: req.user.name,
            data: {name: req.params.name},
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(
            payload,
            req.user.isSuper
        ).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doGetBaseCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "baseCurrency",
            user: req.user.name,
            data: {effective: query.effective},
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doConvertCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "convertCurrency",
            user: req.user.name,
            data: {
                fromCurrency: query.fromCurrency,
                amount: query.amount,
                toCurrency: query.toCurrency,
                effective: query.effective
            },
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetFeather(req, res) {
        req.params.name = req.params.name.toCamelCase(true);
        doGetMethod("getFeather", req, res);
    }

    function doGetSettingsRow(req, res) {
        doGetMethod("getSettingsRow", req, res);
    }

    function doGetSettingsDefinition(req, res) {
        doGetMethod("getSettingsDefinition", req, res);
    }

    function doGetWorkbook(req, res) {
        doGetMethod("getWorkbook", req, res);
    }

    function doGetWorkbooks(req, res) {
        doGetMethod("getWorkbooks", req, res);
    }

    function registerDataRoute(key) {
        let name = key.toSpinalCase();
        let catalog = settings.data.catalog.data;

        if (catalog[key].isReadOnly) {
            dbRouter.get("/:db/data/" + name + "/:id", doRequest);
        } else {
            dbRouter.post("/:db/data/" + name, doRequest);
            dbRouter.get("/:db/data/" + name + "/:id", doRequest);
            dbRouter.patch("/:db/data/" + name + "/:id", doRequest);
            dbRouter.delete("/:db/data/" + name + "/:id", doRequest);
        }

        if (catalog[key].plural) {
            name = catalog[key].plural.toSpinalCase();
            dbRouter.post("/:db/data/" + name, doQueryRequest);
        }

    }

    function registerDataRoutes() {
        let keys;
        let catalog = settings.data.catalog.data;

        keys = Object.keys(catalog).filter((key) => key !== "UserAccount");
        keys.forEach(registerDataRoute);
    }

    function doSaveWorkbook(req, res) {
        let payload = {
            method: "PUT",
            name: "saveWorkbook",
            user: req.user.name,
            data: {
                specs: req.body
            },
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(
            function () {
                registerDataRoutes();
                respond.bind(res)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doSaveSettings(req, res) {
        let payload = {
            method: "PUT",
            name: "saveSettings",
            user: req.user.name,
            data: {
                name: req.params.name,
                etag: req.body.etag,
                data: req.body.data
            },
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(
            function (resp) {
                registerDataRoutes();
                respond.bind(res, resp)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doDeleteWorkbook(req, res) {
        let payload = {
            method: "DELETE",
            name: "deleteWorkbook",
            user: req.user.name,
            data: {name: req.params.name},
            tenant: req.tenant
        };
        if (req.isCamelCase) {
            payload.data.name = payload.data.name.toCamelCase(true);
        }

        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "subscribe",
            user: req.user.name,
            id: query.id,
            subscription: query.subscription,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnsubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "unsubscribe",
            user: req.user.name,
            subscription: query.subscription,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doLock(req, res) {
        let username = req.user.name;

        logger.verbose("Lock " + req.body.id);
        datasource.lock(
            req.body.id,
            username,
            req.body.eventKey,
            undefined,
            false,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnlock(req, res) {
        let criteria;
        let usr = req.user.name;

        criteria = {
            id: req.body.id,
            username: usr
        };

        logger.verbose("Unlock " + req.body.id);
        datasource.unlock(
            criteria,
            undefined,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doPackageModule(req, res) {
        let name = req.params.name;
        let username = req.user.name;

        logger.verbose("Package " + name);
        datasource.package(
            name,
            username,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doInstall(req, res) {
        let query = qs.parse(req.params.query);
        const DIR = "./files/" + "tmp_" + f.createId();
        const TEMPFILE = DIR + ".zip";

        function cleanup() {
            rimraf(DIR); // Remove temp dir
            fs.unlink(TEMPFILE, function () { // Remove zip
                if (!res.headersSent) {
                    res.json(true);
                }
            });
        }

        fs[mkdirsync](DIR); // Create temp dir

        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        logger.verbose("Install");

        // The name of the input field
        let file = req.files.package;

        // Move the file to a install folder
        file.mv(TEMPFILE, function (err) {
            if (err) {
                return res.status(500).send(err);
            }

            let zip = new AdmZip(TEMPFILE);

            zip.extractAllTo(DIR, true);
            datasource.install(
                DIR,
                req.user.name,
                {
                    subscription: query.subscription,
                    tenant: req.tenant,
                    databases: query.databases
                }
            ).catch(function (err) {
                return new Promise(function (resolve) {
                    error.bind(res)(err);
                    resolve();
                });
            }).finally(cleanup);
        });
    }

    async function doUpgrade(req, res) {
        let query = qs.parse(req.params.query);
        const DIR = "./";

        logger.verbose("Upgrade");

        try {
            await datasource.install(
                DIR,
                req.user.name,
                {
                    subscription: query.subscription,
                    tenant: req.tenant,
                    databases: query.databases
                }
            );
            respond.bind(res)();
        } catch (err) {
            error.bind(res)(err);
        }
    }

    function doExport(req, res) {
        let apiPath = req.url.replace("/do/export", "");
        let feather = resolveName(apiPath);
        logger.verbose("Export", feather, req.params.format);

        datasource.export(
            feather,
            req.body.properties,
            req.body.filter || {},
            "./files/downloads/",
            req.params.format,
            req.user.name,
            req.body.subscription,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUpload(req, res) {
        const DIR = "./files/upload/";
        if (!fileUpload) {
            return res.status(400).send("File uploads not allowed.");
        }
        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        let file = req.files.dataFile;
        let owrite = file.overwrite;
        let filePath = DIR + file.name;
        fs.stat(filePath, function (ignore, stat) {
            if (stat && !owrite) {
                res.json({
                    message: "File already exists",
                    status: "exists"
                });
            } else {
                file.mv(filePath, function (err) {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({
                            message: "Failed to persist file",
                            status: "failed"
                        });
                    }
                    res.json({message: "Uploaded file", status: "success"});
                });
            }
        });
    }
    function doImport(req, res) {
        let id = f.createId();
        let format = req.params.format;
        let apiPath = req.url.slice(10);
        let feather = resolveName(apiPath);
        let query = qs.parse(req.params.query);
        const DIR = "./files/import/";
        const TEMPFILE = DIR + id + "." + format;

        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        logger.verbose("Import", format, feather);

        // The name of the input field
        let file = req.files.import;

        // Move the file to a install folder
        file.mv(TEMPFILE, function (err) {
            if (err) {
                return res.status(500).send(err);
            }

            datasource.import(
                feather,
                format,
                TEMPFILE,
                req.user.name,
                query.subscription,
                req.tenant
            ).then(
                respond.bind(res)
            ).catch(
                error.bind(res)
            );
        });
    }

    function doOpenPdf(req, res) {
        let filepath = "./files/downloads/";
        let file = filepath + req.params.file;

        fs.readFile(file, function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "application.pdf"});
            res.write(resp);
            res.end();
            fs.unlink(file, function () {
                return;
            });
        });
    }

    function doPrintPdfForm(req, res) {
        logger.verbose("Print PDF Form", req.body.form);

        datasource.printPdfForm(
            req.body.form,
            req.body.id || req.body.ids || req.body.data,
            req.body.filename,
            req.user.name,
            req.body.options,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSendMail(req, res) {
        let payload = {
            method: "POST",
            name: "sendMail",
            user: req.user.name,
            data: {
                message: {
                    from: req.body.message.from,
                    to: req.body.message.to,
                    cc: req.body.message.cc,
                    bcc: req.body.message.bcc,
                    subject: req.body.message.subject,
                    text: req.body.message.text,
                    html: req.body.message.html
                },
                pdf: {
                    data: req.body.pdf.data,
                    form: req.body.pdf.form,
                    ids: req.body.pdf.id || req.body.pdf.ids,
                    filename: req.body.pdf.filename
                }
            },
            tenant: req.tenant
        };

        logger.verbose("Send mail");
        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetDownload(req, res) {
        let filePath = "./files/downloads/" + req.params.sourcename;

        res.download(
            filePath,
            req.params.targetname || req.params.sourcename,
            function (err) {
                if (err) {
                    console.error(err);
                    return;
                }
                fs.unlink(filePath, function () {
                    return; //console.log("deleted " + filePath);
                });
            }
        );
    }

    function doProcessFile(req, res) {
        let data = {encoded: null};
        if (!req.user) {
            res.status(401).json("Unauthorized session");
            return;
        }
        return new Promise(function (rev) {
            let url = req.body.url || req.url;
            pdf.fetchBytes(decodeURI(url)).then(function (bytes) {
                if (req.method === "POST" && req.body && (
                    req.body.annotation || req.body.watermark
                )) {
                    pdf.annotate(bytes, req.body).then(function (bytes2) {
                        // data.bytes = bytes;
                        data.encoded = Buffer.from(
                            bytes2,
                            "binary"
                        ).toString("base64");
                        rev();
                    });
                } else {
                    data.encoded = Buffer.from(
                        bytes,
                        "binary"
                    ).toString("base64");
                    rev();
                }
            });

        }).then(function () {
            res.writeHeader(200, "application/json");
            res.write(JSON.stringify(data));
            res.end();
        });
    }

    function doRequestFile(req, res) {
        if (!req.user) {
            res.status(401).json("Unauthorized session");
            return;
        }
        return doGetFile(req, res);
    }

    function doGetFile(req, res) {
        let url = "." + decodeURI(req.url);
        let file = req.params.file || "";
        let suffix = (
            file
            ? file.slice(file.indexOf("."), file.length)
            : url.slice(url.lastIndexOf("."), url.length)
        ).toLowerCase();
        let mimetype;

        switch (suffix) {
        case ".pdf":
            mimetype = {"Content-Type": "application/pdf"};
            break;
        case ".mjs":
        case ".js":
            mimetype = {"Content-Type": "application/javascript"};
            break;
        case ".css":
            mimetype = {"Content-Type": "text/css"};
            break;
        case ".map":
        case ".json":
            mimetype = {"Content-Type": "application/json"};
            break;
        case ".jpeg":
        case ".jpg":
            mimetype = {"Content-Type": "image/jpeg"};
            break;
        case ".png":
            mimetype = {"Content-Type": "image/png"};
            break;
        case ".ttf":
            mimetype = {"Content-Type": "application/x-font-ttf"};
            break;
        case ".otf":
            mimetype = {"Content-Type": "application/x-font-otf"};
            break;
        case ".woff":
            mimetype = {"Content-Type": "font/woff"};
            break;
        case ".woff2":
            mimetype = {"Content-Type": "font/woff2"};
            break;
        default:
            throw new Error("Unknown file type " + suffix);
        }

        fs.readFile(url + file, function (err, resp) {
            if (err) {
                console.log(err);
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, mimetype);
            res.write(resp);
            res.end();
        });
    }

    function doGetIndexFile(ignore, res) {
        let file = (
            debug
            ? "./index_debug.html"
            : "./index.html"
        );
        fs.readFile(file, function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "text/html"});
            res.write(resp);
            res.end();
        });
    }

    async function doSignIn(req, res) {
        let message;
        let rows;
        req.flash = function (ignore, msg) {
            logger.verbose(msg);
            message = msg;
        };

        function next(err) {
            if (err) {
                res.status(res.statusCode).json(message);
                return;
            }

            req.user.mode = mode;
            res.json(req.user);
        }
        rows = await datasource.request({
            filter: {criteria: [{
                property: "name",
                value: req.body.username
            }]},
            method: "GET",
            name: "UserAccount",
            tenant: req.tenant,
            user: req.body.username
        }, true);

        if (!rows.length) {
            res.statusCode = 401;
            message = (
                "User " + req.body.username +
                " does not exist on database " +
                req.tenant.pgDatabase
            );
            next(true);
            return;
        }
        return authenticate(req, res, next);
    }

    function doSignOut(req, res) {
        // Notify all instances on same session
        Object.keys(eventSessions).forEach(function (key) {
            if (eventSessions[key].sessionID === req.sessionID) {
                eventSessions[key]({
                    payload: {
                        subscription: {
                            subscriptionId: "",
                            change: "signedOut",
                            data: {}
                        }
                    }
                });
            }
        });
        req.logout(function () {
            req.session.destroy();
            res.status(200).send();
        });
    }

    function doGetProfile(req, res) {
        let payload = {
            method: "GET",
            name: "getProfile",
            user: req.user.name,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doPutProfile(req, res) {
        let payload = {
            method: "PUT",
            name: "saveProfile",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doPatchProfile(req, res) {
        let payload = {
            method: "PATCH",
            name: "patchProfile",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "isAuthorized",
            user: req.user.name,
            data: {
                user: req.user.name,
                action: req.query.action
            },
            tenant: req.tenant
        };

        if (req.query.id) {
            payload.data.id = req.query.id;
        } else if (req.query.feather) {
            payload.data.feather = req.query.feather;
        }

        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetObjectAuthorizations(req, res) {
        let payload = {
            method: "GET",
            name: "getAuthorizations",
            user: req.user.name,
            data: {
                id: req.body.filter.criteria[0].value
            },
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSaveAuthorization(req, res) {
        let payload = {
            method: "POST",
            name: "saveAuthorization",
            user: req.user.name,
            data: {
                user: req.user.name,
                id: req.body.id,
                role: req.body.role,
                actions: req.body.actions
            },
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doStopProcess(req, res) {
        let payload = {
            method: "POST",
            name: "stopProcess",
            user: req.user.name,
            data: req.body,
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doWorkbookIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "workbookIsAuthorized",
            user: req.user.name,
            data: {
                name: req.params.name,
                user: req.user.name,
                action: req.query.action
            },
            tenant: req.tenant
        };

        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doChangePassword(req, res) {
        let payload = {
            method: "POST",
            name: "changeOwnPassword",
            user: req.user.name,
            data: {
                name: req.user.name,
                oldPassword: req.body.oldPassword,
                newPassword: req.body.newPassword
            },
            tenant: req.tenant
        };

        logger.verbose("Change password for " + req.user.name);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doChangeUserInfo(req, res) {
        let payload = {
            name: req.user.name,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            phone: req.body.phone
        };

        logger.verbose("Change User Info", JSON.stringify(payload, null, 2));
        datasource.changeUserInfo(
            payload,
            req.tenant
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doConnect(req, res) {
        let key = f.createId();
        eventKeys[key] = {
            sessionID: req.sessionID,
            tenant: req.tenant
        };

        respond.bind(res)({
            data: {
                authorized: req.user,
                eventKey: key
            }
        });
    }

    // Listen for changes to feathers, update and broadcast to all
    function subscribeToFeathers() {
        return new Promise(function (resolve, reject) {
            let sid = f.createId();
            let eKey = f.createId();
            let payload = {
                name: "Feather",
                method: "GET",
                user: systemUser,
                subscription: {
                    id: sid,
                    eventKey: eKey
                },
                tenant: false
            };

            function changeCallback(resp) {
                // Update all clients
                Object.keys(eventSessions).forEach(function (key) {
                    if (eventSessions[key].sessionID) {
                        eventSessions[key]({
                            payload: {
                                subscription: {
                                    change: "feather",
                                    deleted: false
                                },
                                data: resp
                            }
                        });
                    }
                });
            }

            // Response function in case a feather changes
            eventSessions[eKey] = function (message) {
                let name;

                if (
                    message.payload.subscription.change === "create" ||
                    message.payload.subscription.change === "update"
                ) {
                    name = message.payload.data.name;

                    // Update server with route changes
                    registerDataRoute(name);

                    // Get feather to update client
                    datasource.request({
                        method: "GET",
                        name: "getFeather",
                        user: systemUser,
                        data: {
                            name: message.payload.data.name
                        },
                        tenant: false
                    }, true).then(changeCallback).catch(reject);
                } else if (message.payload.subscription.change === "delete") {
                     // Update all clients
                    Object.keys(eventSessions).forEach(function (key) {
                        if (eventSessions[key].sessionID) {
                            eventSessions[key]({
                                payload: {
                                    subscription: {
                                        change: "feather",
                                        deleted: true
                                    },
                                    data: message.payload.data
                                }
                            });
                        }
                    });
                }

                // Update subscription
                delete payload.client;
                datasource.request(payload, true);
            };

            datasource.request(payload, true).then(resolve).catch(reject);
        });
    }

    // Listen for changes to catalog, refresh if changed
    async function subscribeToCatalog() {
        let eKey = f.createId();

        // Refresh the local copy of the catalog if it changes
        eventSessions[eKey] = function () {
            datasource.getCatalog().catch(console.log);
        };
        eventSessions[eKey].fetch = false;

        await datasource.request({
            name: "getSettings",
            method: "GET",
            user: systemUser,
            subscription: {id: f.createId(), eventKey: eKey},
            data: {name: "catalog"},
            tenant: false
        }, true);
    }

    // Listen for changes to routes, refresh if changed
    async function subscribeToRoutes() {
        let sid = f.createId();
        let eKey = f.createId();

        // Reregister routes if something changes
        eventSessions[eKey] = async function () {
            routes = await datasource.getRoutes();
            routes.forEach(registerRoute);
        };

        await datasource.request({
            name: "Route",
            method: "GET",
            user: systemUser,
            subscription: {id: sid, eventKey: eKey},
            tenant: false
        }, true);
    }

    // HANDLE PUSH NOTIFICATION -------------------------------
    // Receiver callback for all events, sends only to applicable instance.
    let pending = [];
    let isFetching = false;

    function processFetch() {
        if (!isFetching && pending.length) {
            isFetching = true;
            let job = pending[0];
            let jobId = job.payload.id;
            let jobName = job.payload.name;
            datasource.request(job.payload, true).then(function (resp) {
                // Group together any other responses for the same
                // record to reduce duplicate queries
                let jobs = pending.filter(
                    (p) => (
                        p.payload.id === jobId &&
                        p.payload.name === jobName
                    )
                );
                jobs.forEach(function (thejob) {
                    let idx = pending.indexOf(thejob);
                    pending.splice(idx, 1);
                    thejob.callback(resp);
                });
                isFetching = false;
                processFetch();
            }).catch(function (e) {
                console.error(e);
            });
        }
    }

    function receiver(message, pTenant) {
        let eventKey = message.payload.subscription.eventkey;
        let change = message.payload.subscription.change;
        let fn = eventSessions[eventKey];

        function cb(resp) {
            if (resp) {
                message.payload.data = resp;
            }

            fn(message);
        }

        if (fn) {
            if (fn.fetch === false) {
                cb();
                return;
            }

            // If record change, fetch new record
            if (change === "create" || change === "update") {
                pending.push({
                    payload: {
                        name: message.payload.data.table.toCamelCase(true),
                        method: "GET",
                        user: systemUser,
                        id: message.payload.data.id,
                        tenant: pTenant
                    },
                    callback: cb
                });
                processFetch();
                return;
            }

            cb();
        }
    }

    function handleEvents() {
        // Instantiate event key for web socket connection
        wss.on("connection", function connection(ws, req) {
            let eKey;

            ws.on("message", function incoming(key) {
                let sessionID;

                eKey = key;

                if (eventKeys[key]) {
                    sessionID = eventKeys[key].sessionID;
                } else {
                    ws.send("Invalid event key " + key);
                    return;
                }

                eventSessions[eKey] = function (message) {
                    let data = JSON.stringify({
                        message: message.payload
                    });
                    ws.send(data);
                };
                eventSessions[eKey].sessionID = sessionID;

                logger.verbose("Listening for events " + eKey);
            });

            ws.on("close", function close() {
                let db = req.url.replaceAll("/", "");
                let tenant = tenants.find((t) => t.pgDatabase === db);
                delete eventSessions[eKey];
                datasource.unsubscribe(eKey, "instance", tenant);
                datasource.unlock({
                    eventKey: eKey
                });

                logger.info("Closed instance " + eKey);
            });
        });
    }

    async function listenToTenants() {
        let tenant;
        let n = 0;

        try {
            while (n < tenants.length) {
                tenant = tenants[n];
                if (!tenant.listenerConn) {
                    await datasource.listen(tenant, receiver);
                }
                n += 1;
            }
        } catch (err) {
            return Promise.reject(err);
        }
    }

    // Listen for changes to tenants, refresh if changed
    async function subscribeToTenants() {
        let sid = f.createId();
        let eKey = f.createId();

        // Reregister routes if something changes
        eventSessions[eKey] = async function () {
            tenants = await datasource.loadTenants();
            await listenToTenants();
        };

        await datasource.request({
            name: "Tenant",
            method: "GET",
            user: systemUser,
            subscription: {id: sid, eventKey: eKey},
            tenant: false
        }, true);
    }

    async function start() {
        // Define exactly which directories and files are to be served
        let dirs = [
            "/client",
            "/client/components",
            "/client/models",
            "/common",
            "/fonts",
            "/node_modules/codemirror/addon/lint",
            "/node_modules/codemirror/lib",
            "/node_modules/codemirror/mode/javascript",
            "/node_modules/codemirror/mode/css",
            "/node_modules/typeface-raleway/files",
            "/node_modules/print-js/dist",
            "/node_modules/tinymce",
            "/node_modules/tinymce/icons/default",
            "/node_modules/tinymce/skins/ui/oxide",
            "/node_modules/tinymce/skins/ui/oxide/fonts",
            "/node_modules/tinymce/skins/ui/oxide-dark",
            "/node_modules/tinymce/skins/ui/oxide-dark/fonts",
            "/node_modules/tinymce/skins/content/default",
            "/node_modules/tinymce/skins/content/dark",
            "/node_modules/tinymce/skins/content/document",
            "/node_modules/tinymce/skins/content/writer",
            "/node_modules/tinymce/themes/silver",
            "/node_modules/tinymce/themes/mobile",
            "/media"
        ];

        let files = [
            "/api.json",
            "/index.html",
            "/media/featherbone.png",
            "/css/featherbone.css",
            "/css/print.css",
            "/node_modules/big.js/big.mjs",
            "/node_modules/event-source-polyfill/src/eventsource.js",
            "/node_modules/fast-json-patch/dist/fast-json-patch.js",
            "/node_modules/fast-json-patch/dist/fast-json-patch.min.js",
            "/node_modules/dialog-polyfill/dialog-polyfill.js",
            "/node_modules/mithril/mithril.js",
            "/node_modules/mithril/mithril.min.js",
            "/node_modules/qs/dist/qs.js",
            "/node_modules/purecss/build/pure-min.css",
            "/node_modules/purecss/build/grids-responsive-min.css",
            "/node_modules/dialog-polyfill/dialog-polyfill.css",
            "/node_modules/codemirror/theme/neat.css",
            "/node_modules/typeface-raleway/index.css",
            "/node_modules/gantt/dist/gantt.min.js"
        ];

        // Resolve database
        dbRouter.param("db", function (req, res, next, id) {
            let tenant = tenants.find((t) => id === t.pgDatabase);
            if (tenant) {
                req.database = id;
                req.tenant = tenant;
                next();
                return;
            }
            res.sendStatus(404);
            console.error(
                "Database " + id +
                " is not a registered tenant"
            );
        });

        // static pages
        // configure app to use bodyParser()
        // this will let us get the data from a POST
        app.use(bodyParser.urlencoded({
            extended: true
        }));
        app.use(bodyParser.json({limit: "5mb"}));

        // Set up authentication with passport
        passport.use(new LocalStrategy(
            function (username, password, done) {
                //console.log("Login process:", username);
                datasource.authenticate(username, password).then(
                    function (user) {
                        return done(null, user);
                    }
                ).catch(
                    function (err) {
                        console.error("/signin: " + err);
                        return done(null, false, {
                            message: err.message
                        });
                    }
                );
            }
        ));

        passport.serializeUser(function (user, done) {
            //console.log("serialize ", user);
            done(null, user.name);
        });

        passport.deserializeUser(function (name, done) {
            //console.log("deserualize ", name);
            datasource.deserializeUser(name).then(
                function (user) {
                    //console.log("deserializeUser", user);
                    done(null, user);
                }
            ).catch(done);
        });

        // Initialize passport
        app.use(express.static("public"));
        app.use(session({
            store: new PgSession({
                pool: pgPool,
                tableName: "$session"
            }),
            secret: thesecret,
            resave: true,
            rolling: true,
            saveUninitialized: false,
            cookie: {
                secure: "auto",
                maxAge: sessionTimeout
            },
            genid: () => f.createId()
        }));
        app.use(bodyParser.urlencoded({extended: false}));
        app.use(passport.initialize());
        app.use(passport.session());

        dbRouter.post("/:db/sign-in", doSignIn);
        dbRouter.post("/:db/sign-out", doSignOut);

        // Block unauthorized requests to internal data
        app.use(function (req, res, next) {
            let target = req.url.slice(1);
            let interval = req.session.cookie.expires - new Date();
            if (req.database) { // remove database
                target = target.slice(req.database.length);
            }
            target = target.slice(0, target.indexOf("/"));
            if (!req.user && check.indexOf(target) !== -1) {
                res.status(401).json("Unauthorized session");
                return;
            }

            if (req.session && sessions[req.sessionID]) {
                clearTimeout(sessions[req.sessionID]);
            }
            if (req.user) {
                webauthn.applyToken(req);
                req.user.mode = mode;
                sessions[req.sessionID] = setTimeout(function () {
                    logger.verbose("Session " + req.sessionID + " timed out");
                    doSignOut(req, res);
                }, interval);
            }

            next();
        });

        // static pages
        dbRouter.get("/:db/files/downloads/:sourcename", doGetDownload);
        dbRouter.get(
            "/:db/files/downloads/:sourcename/:targetname",
            doGetDownload
        );
        // File upload
        dbRouter.use(expressFileUpload());
        dbRouter.get("/:db/", doGetIndexFile);
        app.use("/", dbRouter);
        dirs.forEach((dirname) => app.get(dirname + "/:filename", doGetFile));
        files.forEach((filename) => app.get(filename, doGetFile));

        // Uploaded files
        if (fileUpload) {
            app.get("/files/upload/:filename", doRequestFile);
            app.post("/files/upload/:filename", doProcessFile);
        }

        // Create routes for each catalog object
        registerDataRoutes();

        // REGISTER CORE ROUTES -------------------------------
        logger.info("Registering core routes");
        dbRouter.get("/:db/webauthn/reg", webauthn.doWebAuthNRegister);
        dbRouter.post("/:db/webauthn/reg", webauthn.postWebAuthNRegister);
        dbRouter.get("/:db/webauthn/auth", webauthn.doWebAuthNAuthenticate);
        dbRouter.post("/:db/webauthn/auth", webauthn.postWebAuthNAuthenticate);
        dbRouter.post("/:db/connect", doConnect);
        dbRouter.post("/:db/data/user-accounts", doQueryRequest);
        dbRouter.post("/:db/data/user-account", doPostUserAccount);
        dbRouter.get("/:db/data/user-account/:id", doRequest);
        dbRouter.get("/:db/pdf/:file", doOpenPdf);
        dbRouter.patch("/:db/data/user-account/:id", doPatchUserAccount);
        dbRouter.delete("/:db/data/user-account/:id", doRequest);
        dbRouter.get("/:db/currency/base", doGetBaseCurrency);
        dbRouter.get("/:db/currency/convert", doConvertCurrency);
        dbRouter.get("/:db/do/is-authorized", doIsAuthorized);
        dbRouter.post("/:db/do/aggregate/", doAggregate);
        dbRouter.post(
            "/:db/data/object-authorizations",
            doGetObjectAuthorizations
        );
        dbRouter.post("/:db/do/change-password/", doChangePassword);
        dbRouter.post("/:db/do/change-user-info/", doChangeUserInfo);
        dbRouter.post("/:db/do/save-authorization", doSaveAuthorization);
        dbRouter.post("/:db/do/stop-process", doStopProcess);
        dbRouter.post("/:db/do/export/:format/:feather", doExport);
        dbRouter.post("/:db/do/import/:format/:feather/:query", doImport);
        dbRouter.post("/:db/do/upload", doUpload);
        dbRouter.post("/:db/do/print-pdf/form/", doPrintPdfForm);
        dbRouter.post("/:db/do/send-mail", doSendMail);
        dbRouter.post("/:db/do/subscribe/:query", doSubscribe);
        dbRouter.post("/:db/do/unsubscribe/:query", doUnsubscribe);
        dbRouter.post("/:db/do/lock", doLock);
        dbRouter.post("/:db/do/unlock", doUnlock);
        dbRouter.get("/:db/feather/:name", doGetFeather);
        dbRouter.post("/:db/module/package/:name", doPackageModule);
        dbRouter.post("/:db/module/install/:query", doInstall);
        dbRouter.post("/:db/do/upgrade/:query", doUpgrade);
        dbRouter.get("/:db/profile", doGetProfile);
        dbRouter.put("/:db/profile", doPutProfile);
        dbRouter.patch("/:db/profile", doPatchProfile);
        dbRouter.get("/:db/settings/:name", doGetSettingsRow);
        dbRouter.put("/:db/settings/:name", doSaveSettings);
        dbRouter.get("/:db/settings-definition", doGetSettingsDefinition);
        dbRouter.get("/:db/workbooks", doGetWorkbooks);
        dbRouter.get(
            "/:db/workbook/is-authorized/:name",
            doWorkbookIsAuthorized
        );
        dbRouter.get("/:db/workbook/:name", doGetWorkbook);
        dbRouter.put("/:db/workbook/:name", doSaveWorkbook);
        dbRouter.delete("/:db/workbook/:name", doDeleteWorkbook);

        await listenToTenants();
        handleEvents();

        // REGISTER MODULE ROUTES
        routes.forEach(registerRoute);

        // START THE SERVER
        // ====================================================================
        const server = app.listen(port);
        // Enable web sockets to listen on the same port as http
        server.on("upgrade", function (request, socket, head) {
            wss.handleUpgrade(request, socket, head, function (socket) {
                wss.emit("connection", socket, request);
            });
        });
        console.log("Magic happens on port " + port);
    }

    // ..........................................................
    // FIRE IT UP
    //

    init().then(
        subscribeToTenants
    ).then(
        subscribeToFeathers
    ).then(
        subscribeToCatalog
    ).then(
        subscribeToRoutes
    ).then(start).catch(process.exit);
}());
