/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*global f*/

/**
    @module Core
*/

function dataService(data, feather) {
    let model;

    feather = feather || f.catalog().getFeather("DataService");
    model = f.createModel(data, feather);

    /**
        Modules datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.modules
        @for Models.DataService
        @type Property
    */
    model.addCalculated({
        name: "modules",
        type: "array",
        function: f.catalog().store().data().modules
    });

    return model;
}

f.catalog().registerModel("DataService", dataService);
