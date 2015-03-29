﻿/**
    Featherbone is a JavaScript based persistence framework for building object relational database applications
    
    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/** Expose certain js functions to the database for use as defaults **/
create or replace function fp.request(obj json, init boolean default false) returns json as $$
  return (function () {
    if (init || !plv8._init) {
      plv8.execute('select fp.init()'); 
    }

    return featherbone.request(obj);
  }());
$$ language plv8;

do $$
   plv8.execute('select fp.init()');
   var sqlChk = "select * from pg_tables where schemaname = 'fp' and tablename = $1;",
     sqlCmt = "comment on column %I.%I.%I is %L",
     sql,
     params;

   /** Create the base object table **/
   if (!plv8.execute(sqlChk,['object']).length) {
     sql = "create table fp.object (" +
       "_pk bigserial primary key," +
       "id text unique not null," +
       "created timestamp with time zone not null," +
       "created_by text not null," +
       "updated timestamp with time zone not null," +
       "updated_by text not null," +
       "etag text not null," +
       "is_deleted boolean not null)";
     plv8.execute(sql);
     plv8.execute("comment on table fp.object is 'Abstract object class from which all other classes will inherit'");
     plv8.execute(sqlCmt.format(['fp','object','_pk','Internal primary key']));
     plv8.execute(sqlCmt.format(['fp','object','id','Surrogate key']));
     plv8.execute(sqlCmt.format(['fp','object','created','Create time of the record']));
     plv8.execute(sqlCmt.format(['fp','object','created_by','User who created the record']));
     plv8.execute(sqlCmt.format(['fp','object','updated','Last time the record was updated']));
     plv8.execute(sqlCmt.format(['fp','object','updated_by','Last user who created the record']));
     plv8.execute(sqlCmt.format(['fp','object','is_deleted','Indicates the record is no longer active']));
   };

   /** Create the base log table **/
   if (!plv8.execute(sqlChk,['log']).length) {
     sql = "create table fp.log (" +
       "change json not null default '{}'," +
       "constraint log_pkey primary key (_pk), " +
       "constraint log_id_key unique (id)) inherits (fp.object)";
     plv8.execute(sql);
     plv8.execute("comment on table fp.log is 'Class for logging all schema and data changes'");
     plv8.execute(sqlCmt.format(['fp','log','change','Patch formatted json indicating changes']));
   };

   /** Create the settings table **/
   if (!plv8.execute(sqlChk,['_settings']).length) {
     sql = "create table fp._settings (" +
       "name text not null default ''," +
       "data json not null default '{}'," +
       "constraint settings_pkey primary key (_pk), " +
       "constraint settings_id_key unique (id)) inherits (fp.object)";
     plv8.execute(sql);
     plv8.execute("comment on table fp._settings is 'Internal table for storing system settyngs'");
     plv8.execute(sqlCmt.format(['fp','_settings','name','Name of settings']));
     plv8.execute(sqlCmt.format(['fp','_settings','data','Object containing settings']));
     sql = "insert into fp._settings values (nextval('fp.object__pk_seq'), $1, now(), current_user, now(), current_user, $2, false, $3, $4);";
     params = [
       featherbone.createId(),
       featherbone.createId(),
       'catalog',
       {"Object": {
         "description": "Abstract object class from which all other classes will inherit",
         "properties": {
             "id": {
               "description": "Surrogate key",
               "type": "string",
               "defaultValue": "createId()"},
             "created": {
               "description": "Create time of the record",
               "type": "date",
               "defaultValue": "now()"},
             "createdBy": {
               "description": "User who created the record",
               "type": "string",
               "defaultValue": "getCurrentUser()"},
             "updated": {
               "description": "Last time the record was updated",
               "type": "date",
               "defaultValue": "now()"},
             "updatedBy": {
               "description": "User who created the record",
               "type": "string",
               "defaultValue": "getCurrentUser()"},
             "isDeleted": {
               "description": "Indicates the record is no longer active",
               "type": "boolean"},
             "etag": {
               "description": "Optimistic lock key",
               "type": "string",
               "defaultValue": "createId()"}
             }
          },
         "Log": {
         "description": "Class for logging all schema and data changes",
         "inherits": "Object",
         "properties": {
             "change": {
               "description": "Patch formatted json indicating changes",
               "type": "object"}
             }
          }
       }
     ]
     plv8.execute(sql, params);
   };
$$ language plv8;