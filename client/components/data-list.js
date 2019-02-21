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
/*jslint this, browser*/
import f from "../core.js";
import catalog from "../models/catalog.js";
import list from "../models/list.js";
import button from "./button.js";
import dialog from "./dialog.js";
import tableWidget from "./table-widget.js";

const dataList = {};
const table = {};
const m = window.m;

table.viewModel = function (options) {
    let tableState;
    let vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.buttonAdd = f.prop();
    vm.buttonOpen = f.prop();
    vm.buttonRemove = f.prop();
    vm.buttonUndo = f.prop();
    vm.tableWidget = f.prop();

    // ..........................................................
    // PRIVATE
    //

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
        config: {
            columns: [{
                attr: "value"
            }, {
                attr: "label"
            }]
        },
        models: options.models,
        feather: "DataListOption",
        height: "250px"
    }));
    vm.tableWidget().toggleEdit();
    vm.tableWidget().isQuery(false);

    // Create button view models
    vm.buttonAdd(button.viewModel({
        onclick: vm.tableWidget().modelNew,
        title: "Insert",
        hotkey: "I",
        icon: "plus-circle",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(button.viewModel({
        onclick: vm.tableWidget().modelDelete,
        title: "Delete",
        hotkey: "D",
        icon: "trash",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonRemove().disable();

    vm.buttonUndo(button.viewModel({
        onclick: vm.tableWidget().undo,
        title: "Undo",
        hotkey: "U",
        icon: "undo",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonUndo().hide();

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonRemove().disable();
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
        vm.buttonRemove().enable();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonRemove().hide();
        vm.buttonUndo().show();
    });

    return vm;
};

table.component = {
    oninit: function (vnode) {
        this.viewModel = vnode.attrs.viewModel;
    },

    view: function () {
        let vm = this.viewModel;

        return m("div", [
            m(button.component, {
                viewModel: vm.buttonAdd()
            }),
            m(button.component, {
                viewModel: vm.buttonRemove()
            }),
            m(button.component, {
                viewModel: vm.buttonUndo()
            }),
            m(tableWidget.component, {
                viewModel: vm.tableWidget()
            })
        ]);
    }
};

dataList.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;
    let dlg;

    vm.buttonEdit = f.prop();
    vm.dataListDialog = f.prop();
    vm.content = function () {
        let value = vm.prop() || [];

        return f.types.array.tableData({
            value: value,
            options: {}
        });
    };
    vm.doEdit = function () {
        let models = vm.models();
        let dataListDialog = vm.dataListDialog();
        let value = vm.prop() || [];
        let model = catalog.store().models().dataListOption;

        function applyEdit() {
            let models = vm.models().slice();
            
            models = models.filter((i) => i.state().current()[0] !== "/Delete");
            vm.prop(models.map(function (i) {
                return {
                    value: i.data.value(),
                    label: i.data.label()
                };
            }));
        }

        models.reset();
        value.forEach(function (i) {
            let instance = model(i);

            instance.state().goto("/Ready/Fetched/Clean");
            models.add(instance);
        });
        models.state().goto("/Fetched/Clean");
        dataListDialog.onOk(applyEdit);
        dataListDialog.okDisabled(true);
        dataListDialog.show();
    };
    vm.id = f.prop(options.id || f.createId());
    vm.models = list("DataListOption")({fetch: false});
    vm.prop = parent.model().data[options.parentProperty];
    vm.style = f.prop(options.style || {});
    vm.table = f.prop();

    // ..........................................................
    // PRIVATE
    //

    vm.dataListDialog(dialog.viewModel({
        icon: "edit",
        title: "Data list"
    }));

    dlg = vm.dataListDialog();
    dlg.content = function () {
        return m(table.component, {
            viewModel: vm.table()
        });
    };
    dlg.style().width = "480px";
    dlg.style().height = "450px";

    vm.models().canAdd = f.prop(true);
    vm.models().state().resolve("/Fetched/Dirty").enter(
        () => dlg.okDisabled(false)
    );

    vm.table(table.viewModel({
        models: vm.models(),
        containterId: vm.dataListDialog().ids().dialog
    }));

    vm.buttonEdit(button.viewModel({
        onclick: vm.doEdit,
        title: "Edit relation details",
        icon: "edit",
        class: "fb-data-type-edit-button"
    }));

    return vm;
};

dataList.component = {
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = dataList.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            style: options.style,
            readonly: options.readonly
        });
    },

    view: function (vnode) {
        let vm = this.viewModel;
        let style = vm.style();
        let readonly = vnode.attrs.readonly === true;
        let id = vm.id();

        if (readonly) {
            vm.buttonEdit().disable();
        } else {
            vm.buttonEdit().enable();
        }

        style.display = style.display || "inline-block";

        // Build the view
        return m("div", {
            style: style
        }, [
            m(dialog.component, {
                viewModel: vm.dataListDialog()
            }),
            m("input", {
                id: id,
                key: id,
                class: "fb-data-list-input",
                onchange: vm.onchange,
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                value: vm.content(),
                readonly: true,
                title: vm.content()
            }),
            m(button.component, {
                viewModel: vm.buttonEdit()
            })
        ]);
    }
};

catalog.register("components", "dataList", dataList.component);

export default Object.freeze(dataList);
