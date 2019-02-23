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
import catalog from "./catalog.js";
import model from "./model.js";

/*
  Module Model
*/
function module(data, feather) {
    feather = feather || catalog.getFeather("Module");
    let that = model(data, feather);

    that.state().resolve("/Ready/Fetched/Clean").enter(function () {
        that.data.name.isReadOnly(true);
    });

    return that;
}

module.static = f.prop({
    package: function (viewModel) {
        "use strict";

        let element = document.createElement('a');
        element.setAttribute("href", "/uploads/test.zip");
        element.setAttribute("download", "mytest");

        element.style.display = "none";
        document.body.appendChild(element);

        element.click();

        document.body.removeChild(element);
    },
    packageCheck: function (selections) {
        "use strict";

        return selections.length === 1;
    }
});

catalog.registerModel("Module", module, true);
