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
import {f} from "../core.js";
import {catalog} from "./catalog.js";
import {model} from "./model.js";

function form(data, feather) {
    let that;

    function feathers() {
        let tables = catalog.store().feathers();
        let keys = Object.keys(tables);

        keys = keys.filter(function (key) {
            return !tables[key].isSystem;
        }).sort();

        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    function modules() {
        let tables = catalog.store().feathers();
        let keys = Object.keys(tables);
        let ary = [];

        keys.forEach(function (key) {
            let mod = tables[key].module;

            if (mod && ary.indexOf(mod) === -1) {
                ary.push(mod);
            }
        });

        return ary.map(function (item) {
            return {
                value: item,
                label: item
            };
        });
    }

    function properties() {
        let keys;
        let formFeather = that.data.feather();
        let result = [];

        if (!formFeather) {
            return result;
        }
        formFeather = catalog.getFeather(formFeather);
        keys = Object.keys(formFeather.properties || []).sort();
        keys.unshift("");
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    function handleProperties() {
        that.data.properties(properties());
    }

    feather = feather || catalog.getFeather("Form");
    that = model(data, feather);

    that.addCalculated({
        name: "feathers",
        type: "array",
        function: feathers
    });

    that.addCalculated({
        name: "modules",
        type: "array",
        function: modules
    });

    that.addCalculated({
        name: "properties",
        type: "array",
        function: f.prop()
    });

    that.onChanged("feather", handleProperties);
    that.state().resolve("/Ready/Fetched/Clean").enter(handleProperties);

    return that;
}

catalog.register("models", "form", form);

export {form};