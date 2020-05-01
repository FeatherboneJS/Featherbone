/*
    Framework for building object relational database apps
    Copyright (C) 2020  John Rogelstad

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
/*jslint browser*/
import f from "../core.js";
import catalog from "./catalog.js";
import datasource from "../datasource.js";

function module(data, feather) {
    feather = feather || catalog.getFeather("Module");
    let model = f.createModel(data, feather);

    model.onLoad(function () {
        model.data.name.isReadOnly(true);
    });

    return model;
}

module.static = f.prop({
    install: function (viewModel) {
        let input = document.createElement("input");
        let dialog = viewModel.confirmDialog();

        function error(err) {
            dialog.message(err.message);
            dialog.title("Error");
            dialog.icon("exclamation-triangle");
            dialog.buttonCancel().hide();
            dialog.show();
        }

        function processFile() {
            let file = input.files[0];
            let formData = new FormData();
            let payload;

            formData.append("package", file);
            payload = {
                method: "POST",
                path: "/module/install",
                body: formData
            };

            datasource.request(payload).then(viewModel.refresh).catch(error);
        }

        input.setAttribute("type", "file");
        input.setAttribute("accept", ".zip");
        input.onchange = processFile;
        input.click();
    },
    package: function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let selection = viewModel.selections()[0];
        let name = selection.data.name();
        let payload = {
            method: "POST",
            path: "/module/package/" + name
        };

        function download(filename) {
            let element = document.createElement("a");

            element.setAttribute("href", "files/downloads/" + filename);
            element.setAttribute("download", filename);
            element.style.display = "none";

            document.body.appendChild(element);

            element.click();

            document.body.removeChild(element);
        }

        function error(err) {
            dialog.message(err.message);
            dialog.title("Error");
            dialog.icon("exclamation-triangle");
            dialog.buttonCancel().hide();
            dialog.show();
        }

        datasource.request(payload).then(download).catch(error);
    },
    packageCheck: function (selections) {
        return (
            selections.length === 1 &&
            !selections.some((sel) => sel.naturalKey() === "Core")
        );
    }
});

catalog.registerModel("Module", module);
