/**
 * This module contains functions related to Object Document Mapping between JavaScript and MongoDB.
 *
 * @author <a href="mailto:plopes@roughcookie.com">Paulo Lopes</a>
 * @version 2.0
 */
'use strict';

/** @private */
var mongodb = require('mongodb');
/** @private */
var ObjectId = mongodb.BSONPure.ObjectID;
/** @private */
var Cursor = mongodb.Cursor;
/** @private */
var objectIdRegExp = /^[0-9a-fA-F]{24}$/;
/** @private */
var baseModel = require('./model');
/** @private */
var common = require('./common');

var extractOption = common.extractOption;
var getOption = common.getOption;

/**
 * @private
 * @readonly
 * @const
 *
 * @type {String}
 */
var PROTO = '__proto__';

/**
 * Creates a new Document Model class
 *
 * @param {ODM} odm ODM module
 * @param {String} mongoCollection Collection name, if not present this is an embedded document
 * @param {Object} schemaDef Schema definition
 *
 * @return {Function}
 */
function schemaModelClassGenerator(odm, mongoCollection, schemaDef) {

  /**
   * @global
   * @name SchemaModel
   * @constructor
   * @param {Object} [json] if provided will update the current instance with the json properties
   */
  var SchemaModel = function (json) {
    if (json !== undefined && json !== null) {
      var key;
      for (key in json) {
        if (json.hasOwnProperty(key)) {
          this[key] = json[key];
        }
      }
    }
  };

  /**
   * mongo collection
   * @memberOf SchemaModel
   */
  Object.defineProperty(SchemaModel, '$collection', {value: mongoCollection});

  /**
   * schema for embedded objects
   * @memberOf SchemaModel
   */
  Object.defineProperty(SchemaModel, '$schema', {value: odm.createSchema(schemaDef)});

  /**
   * Verifies if an Object is valid against the configured validator
   * @memberOf SchemaModel.prototype
   * @param {Boolean} [verbose]
   * @return {Boolean|Object}
   */
  SchemaModel.prototype.validate = function (verbose) {
    var validation = odm.validate(this, SchemaModel.$schema);
    if (validation instanceof Array) {
      if (validation.length > 0) {
        if (verbose === true) {
          return validation;
        }
        return false;
      }
    }

    // if no schema, always OK
    if (verbose === true) {
      return null;
    }
    return true;
  };

  /**
   * Helper to have a short syntax
   * @memberOf SchemaModel.prototype
   * @return {Boolean}
   */
  SchemaModel.prototype.isValid = function () {
    return this.validate();
  };

  var BaseModel = baseModel(odm, mongoCollection);

  /**
   * Casts a Object to this model class.
   *
   * @static
   * @memberOf SchemaModel
   * @param {Object} obj Object to cast
   * @return {SchemaModel} the same object but casted
   */
  SchemaModel.cast = function (obj) {
    if (obj !== undefined && obj !== null && typeof obj === 'object') {
      obj[PROTO] = SchemaModel.prototype;
    }
    return obj;
  };

  /**
   * Finds one element of this collection by the given query.
   *
   * @static
   * @memberOf SchemaModel
   * @param {Object} query Query object as in mongodb documentation
   * @param {Object} [fields] filter fields
   * @param {Object} [options] Query options, such as skip, limit, etc
   * @param {Function} callback Callback function (error, model) with the result of the operation
   */
  SchemaModel.findOne = function (query, fields, options, callback) {
    var hasFields = true;

    if (callback === undefined) {
      if (options === undefined) {
        callback = fields;
        options = {};
        fields = {};
        hasFields = false;
      } else {
        callback = options;
        options = fields;
        fields = {};
        hasFields = false;
      }
    }

    var pluck = extractOption('pluck', options);

    if (pluck !== undefined) {
      // state that we only care about the plucked field
      fields[pluck] = true;
      hasFields = true;
    }

    var random = extractOption('random', options);

    if (random) {
      return odm.count(mongoCollection, query, options, function (err, count) {
        if (err) {
          return callback(err);
        }

        options.limit = -1;
        options.skip = count * Math.random();

        return odm.findOne(mongoCollection, query, fields, options, function (err, documentLoaded) {
          if (err) {
            return callback(err);
          }

          if (documentLoaded === null) {
            return callback(null, null);
          }

          if (hasFields) {
            if (pluck !== undefined) {
              documentLoaded = documentLoaded[pluck];
            }
            return callback(null, documentLoaded);
          }

          // enhance the DB document do have ODM features
          documentLoaded[PROTO] = SchemaModel.prototype;
          return callback(null, documentLoaded);
        });
      });
    }

    return odm.findOne(mongoCollection, query, fields, options, function (err, documentLoaded) {
      if (err) {
        return callback(err);
      }

      if (documentLoaded === null) {
        return callback(null, null);
      }

      if (hasFields) {
        if (pluck !== undefined) {
          documentLoaded = documentLoaded[pluck];
        }
      } else {
        documentLoaded[PROTO] = SchemaModel.prototype;
      }

      return callback(null, documentLoaded);
    });
  };

  /**
   * Finds one element of this collection given its Id.
   *
   * @static
   * @memberOf SchemaModel
   * @param {ObjectId|String} id Either a ObjectId instance or, the function will try to cast it to ObjectId.
   * @param {Object} [fields] filter fields
   * @param {Object} [options] Query options, such as skip, limit, etc
   * @param {Function} callback Callback function (error, model) with the result of the operation
   */
  SchemaModel.findById = function (id, fields, options, callback) {
    var hasFields = true;

    if (callback === undefined) {
      if (options === undefined) {
        callback = fields;
        options = {};
        fields = {};
        hasFields = false;
      } else {
        callback = options;
        options = fields;
        fields = {};
        hasFields = false;
      }
    }

    var pluck = extractOption('pluck', options);

    if (pluck !== undefined) {
      // state that we only care about the plucked field
      fields[pluck] = true;
      hasFields = true;
    }

    if (id === undefined) {
      return callback('undefined id');
    }

    var _id;

    if (id instanceof ObjectId) {
      _id = id;
    } else {
      if (typeof id === 'string' && id.length === 24 && objectIdRegExp.test(id)) {
        _id = ObjectId.createFromHexString(id);
      } else {
        return callback('invalid object id');
      }
    }

    return odm.findOne(mongoCollection, {_id: _id}, fields, options, function (err, documentLoaded) {
      if (err) {
        return callback(err);
      }

      // if we search for an Id and get null it should return right away
      if (documentLoaded === null) {
        return callback(mongoCollection + ' ' + _id.toHexString() + ' not found');
      }

      if (hasFields) {
        if (pluck !== undefined) {
          documentLoaded = documentLoaded[pluck];
        }
      } else {
        documentLoaded[PROTO] = SchemaModel.prototype;
      }
      return callback(null, documentLoaded);
    });
  };

  /**
   * Free form find in collection. The result is returned as a Array of this model objects.
   *
   * @static
   * @memberOf SchemaModel
   * @param {Object} query MongoDB Query
   * @param {Object} [fields] filter the fields to be returned
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, model) with the result of the operation
   */
  SchemaModel.find = function (query, fields, options, callback) {
    var hasFields = true;

    if (callback === undefined) {
      if (options === undefined) {
        callback = fields;
        options = {};
        fields = {};
        hasFields = false;
      } else {
        callback = options;
        options = fields;
        fields = {};
        hasFields = false;
      }
    }

    var count = extractOption('count', options);

    if (count) {
      return odm.count(mongoCollection, query, options, callback);
    }

    var pluck = extractOption('pluck', options);
    var wantCursor = getOption('cursor', options);

    if (pluck !== undefined) {
      // state that we only care about the plucked field
      fields[pluck] = true;
      hasFields = true;
    }

    return odm.find(mongoCollection, query, fields, options, function (err, documentsLoaded) {
      if (err) {
        return callback(err);
      }

      if (wantCursor) {
        documentsLoaded.eachModel = function (callback) {
          if (documentsLoaded.state !== Cursor.CLOSED) {
            process.nextTick(function () {
              // Fetch the next object until there is no more objects
              documentsLoaded.nextModel(function (err, item) {
                if (err !== null) {
                  return callback(err, null);
                }
                if (item !== null) {
                  callback(null, item);
                  return documentsLoaded.eachModel(callback);
                }
                // Close the cursor if done
                return documentsLoaded.close(callback);
              });
            });
          } else {
            callback(new Error("Cursor is closed"), null);
          }
        };

        /**
         * @param {Function} callback
         */
        documentsLoaded.nextModel = function (callback) {
          documentsLoaded.nextObject(function (error, item) {
            if (error) {
              return callback(error);
            }
            if (item !== null) {
              if (hasFields) {
                if (pluck !== undefined) {
                  return callback(error, item[pluck]);
                }
              } else {
                item[PROTO] = SchemaModel.prototype;
              }
              return callback(error, item);
            }
          });
        };

        return callback(null, documentsLoaded);
      }

      var i, len;
      if (hasFields) {
        if (pluck !== undefined) {
          for (i = 0, len = documentsLoaded.length; i < len; i++) {
            documentsLoaded[i] = documentsLoaded[i][pluck];
          }
        }
      } else {
        for (i = 0, len = documentsLoaded.length; i < len; i++) {
          documentsLoaded[i][PROTO] = SchemaModel.prototype;
        }
      }
      return callback(null, documentsLoaded);
    });
  };

  /**
   * Finds all elements in this collection.
   *
   * @static
   * @memberOf SchemaModel
   * @param {Object} [fields] filter the fields to be returned
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, model) with the result of the operation
   */
  SchemaModel.findAll = function (fields, options, callback) {
    SchemaModel.find({}, fields, options, callback);
  };

  /**
   * Counts all elements in this collection.
   *
   * @static
   * @memberOf BaseModel
   * @function
   * @param {Object} [query] filter the fields to be returned
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, model) with the result of the operation
   */
  SchemaModel.count = BaseModel.count;

  /**
   * @static
   * @memberOf BaseModel
   * @param {String} collection_name
   * @param {Object} options
   * @param {Function} callback
   */
  SchemaModel.stats = BaseModel.stats;

  /**
   * Loads documents referenced by id/ids. This is a helper function that calls internally find or findById
   * with the correct parameters. The order of the return is guaranteed, while with a find it is not.
   *
   * @static
   * @memberOf SchemaModel
   * @param {ObjectId|ObjectId[]} ids single or array of ObjectId objects
   * @param {Object} [fields] filter the fields to be returned
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, model) with the result of the operation
   */
  SchemaModel.loadDbRef = function (ids, fields, options, callback) {
    var hasFields = true;

    if (callback === undefined) {
      if (options === undefined) {
        callback = fields;
        options = {};
        fields = {};
        hasFields = false;
      } else {
        callback = options;
        options = fields;
        fields = {};
        hasFields = false;
      }
    }

    // special case when the property does not exist
    if (ids === undefined) {
      return callback(null, []);
    }

    if (!ids instanceof Array) {
      return SchemaModel.findById(ids, fields, options, callback);
    }

    var pluck = extractOption('pluck', options);

    if (pluck !== undefined) {
      // state that we only care about the plucked field
      fields[pluck] = true;
      hasFields = true;
    }

    if (ids.length === 0) {
      return callback(null, []);
    }

    // convert the orig array to an index
    var index = {};
    var i, len;
    var idsToFind = [];

    for (i = 0, len = ids.length; i < len; i++) {
      if (!(ids[i] instanceof ObjectId)) {
        return callback('Non ObjectId in the array');
      }

      // build index for the missing data
      if (index[ids[i].toHexString()] === undefined) {
        index[ids[i].toHexString()] = [i];
        idsToFind.push(ids[i]);
      } else {
        index[ids[i].toHexString()].push(i);
      }
    }

    // no items to search
    if (idsToFind.length === 0) {
      return callback(null, []);
    }

    return odm.find(mongoCollection, {_id: {'$in': idsToFind}}, fields, options, function (err, documentsLoaded) {
      if (err) {
        return callback(err);
      }

      // clean up
      idsToFind = null;

      var i, j, lenI, lenJ;
      var result = [];

      // using the index we have O(2n) complexity
      for (i = 0, lenI = documentsLoaded.length; i < lenI; i++) {
        var indexes = index[documentsLoaded[i]._id.toHexString()];
        for (j = 0, lenJ = indexes.length; j < lenJ; j++) {

          if (hasFields) {
            if (pluck !== undefined) {
              result[indexes[j]] = documentsLoaded[i][pluck];
            }
          } else {
            result[indexes[j]] = documentsLoaded[i];

            result[indexes[j]][PROTO] = SchemaModel.prototype;
          }
        }
      }

      // clean up
      index = null;

      return callback(null, result);
    });
  };


  /**
   * Ensure indexes are present
   *
   * @static
   * @memberOf SchemaModel
   * @param {Object} fieldOrSpec
   * @param {Object} [options]
   * @param {Function} callback
   */
  SchemaModel.ensureIndex = function (fieldOrSpec, options, callback) {
    if (callback === undefined) {
      callback = options;
      options = {};
    }

    var indexFields = Object.keys(fieldOrSpec);
    var generateFinder = options.generateFinder === undefined || options.generateFinder === true;

    if (generateFinder && indexFields.length === 1) {
      var field = indexFields[0];
      // only create special finder if the index is not on a sub document
      if (field.indexOf('.') === -1) {
        // create special find with cache method
        var methodName = 'findBy' + field.substr(0, 1).toUpperCase() + field.substr(1);

        var isUnique = false;

        if (options.unique !== undefined && options.unique === true) {
          isUnique = true;
        }

        SchemaModel[methodName] = function (id, fields, options, callback) {
          if (id === undefined) {
            return callback('undefined id');
          }

          var query = {};
          query[field] = id;

          if (isUnique) {
            return SchemaModel.findOne(query, fields, options, callback);
          }
          return SchemaModel.find(query, fields, options, callback);
        };
      }
    }

    odm.collection(mongoCollection, options, function (err, collection) {
      if (err) {
        return callback(err);
      }

      return collection.ensureIndex(fieldOrSpec, options, callback);
    });
  };

  /**
   * Save this object instance to the backend mongodb instance.
   *
   * @memberOf SchemaModel.prototype
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, documentId) with the result of the operation
   */
  SchemaModel.prototype.save = function (options, callback) {
    if (callback === undefined) {
      callback = options;
      options = {};
    }

    var self = this;

    var validation = self.validate(true);
    if (validation !== null) {
      return callback(validation);
    }

    return odm.save(mongoCollection, self, options, function (err, savedDocument) {
      if (err) {
        return callback(err);
      }
      // only inserts have savedDocument
      if (self._id === undefined) {
        if (savedDocument) {
          self._id = savedDocument._id;
        }
      }
      return callback(null, self._id);
    });
  };

  /**
   * Update this object instance to the backend mongodb instance.
   *
   * @memberOf SchemaModel.prototype
   * @param {Object} [partUpdate] update statement
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, documentId) with the result of the operation
   */
  SchemaModel.prototype.update = function (partUpdate, options, callback) {
    if (callback === undefined) {
      if (options === undefined) {
        callback = partUpdate;
        options = {};
        partUpdate = undefined;
      } else {
        callback = options;
        options = {};
      }
    }

    var self = this;
    var validation;

    if (partUpdate !== undefined) {
      var setPath = extractOption('$setpath', partUpdate);
      if (setPath) {
        var path, result, len, i;
        if (setPath instanceof Array) {
          var j, len0;

          for (j = 0, len0 = setPath.length; j < len0; j++) {
            if (typeof setPath[j] === 'string') {
              path = setPath[j].split('.');
              result = self;
              for (i = 0, len = path.length; i < len; i++) {
                result = result[path[i]];
              }
              if (partUpdate.$set === undefined || partUpdate.$set === null) {
                partUpdate.$set = {};
              }
              partUpdate.$set[setPath[j]] = result;
            } else {
              return callback('$setpath only accepts a String path');
            }
          }
        } else {
          if (typeof setPath === 'string') {
            path = setPath.split('.');
            result = self;
            for (i = 0, len = path.length; i < len; i++) {
              result = result[path[i]];
            }
            if (partUpdate.$set === undefined || partUpdate.$set === null) {
              partUpdate.$set = {};
            }
            partUpdate.$set[setPath] = result;
          } else {
            return callback('$setpath only accepts a String path');
          }
        }

        validation = self.validate(true);
        if (validation !== null) {
          return callback(validation);
        }
      }
    } else {
      validation = self.validate(true);
      if (validation !== null) {
        return callback(validation);
      }
    }

    return odm.update(mongoCollection, {_id: self._id}, partUpdate !== undefined ? partUpdate : self, options, callback);
  };

  /**
   * Insert this object instance to the backend mongodb instance.
   *
   * @memberOf SchemaModel.prototype
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, documentId) with the result of the operation
   */
  SchemaModel.prototype.insert = function (options, callback) {
    if (callback === undefined) {
      callback = options;
      options = {};
    }

    var validation = this.validate(true);
    if (validation !== null) {
      callback(validation);
    } else {
      odm.insert(mongoCollection, this, options, callback);
    }
  };

  /**
   * Remove this object instance from the backend mongodb instance.
   *
   * @type {Function}
   * @memberOf SchemaModel.prototype
   * @function
   * @param {Object|Function} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.prototype.remove = BaseModel.prototype.remove;

  /**
   * @type {Function}
   * @memberOf SchemaModel.prototype
   * @function
   * @param {Object|Function} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.prototype.reload = BaseModel.prototype.reload;

  /**
   * @type {Function}
   * @memberOf SchemaModel.prototype
   * @function
   * @param {Object|Function} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.prototype.snapshot = BaseModel.prototype.snapshot;

  /**
   * @type {Function}
   * @memberOf SchemaModel.prototype
   * @function
   * @param {Object|Function} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.prototype.revert = BaseModel.prototype.revert;

  /**
   * @type {Function}
   * @memberOf SchemaModel.prototype
   * @function
   * @param {Object|Function} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.prototype.flush = BaseModel.prototype.flush;

  /**
   * Remove this object instance from the backend mongodb instance.
   *
   * @static
   * @memberOf SchemaModel
   * @function
   * @param {Object} query Search query of objects to remove
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.remove = BaseModel.remove;

  /**
   * Insert this object instance to the backend mongodb instance.
   *
   * @static
   * @memberOf SchemaModel
   * @function
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error, documentId) with the result of the operation
   */
  SchemaModel.insert = BaseModel.insert;

  /**
   * Remove this object instance from the backend mongodb instance.
   *
   * @static
   * @memberOf SchemaModel
   * @function
   * @param {Object} query Search query of objects to remove
   * @param {Object} [options] options for the query
   * @param {Function} callback Callback function (error) with the result of the operation
   */
  SchemaModel.update = BaseModel.update;

  /**
   * Prepares a find statement to run in parallel mode.
   *
   * @param {Object} query
   * @param {Object} [fields]
   * @param {Object} [options]
   * @return {Object} finder object
   */
  SchemaModel.prepareFindOne = function (query, fields, options) {
    return {fn: SchemaModel.findOne, query: query, fields: fields, options: options};
  };

  /**
   * Prepares a find statement to run in parallel mode.
   *
   * @param {ObjectId} id
   * @param {Object} [fields]
   * @param {Object} [options]
   * @return {Object} finder object
   */
  SchemaModel.prepareFindById = function (id, fields, options) {
    return {fn: SchemaModel.findById, query: id, fields: fields, options: options};
  };

  /**
   * Prepares a find statement to run in parallel mode.
   *
   * @param {Object} query
   * @param {Object} [fields]
   * @param {Object} [options]
   * @return {Object} finder object
   */
  SchemaModel.prepareFind = function (query, fields, options) {
    return {fn: SchemaModel.find, query: query, fields: fields, options: options};
  };

  /**
   * Prepares a find statement to run in parallel mode.
   *
   * @param {Object} [fields]
   * @param {Object} [options]
   * @return {Object} finder object
   */
  SchemaModel.prepareFindAll = function (fields, options) {
    return {fn: SchemaModel.find, query: {}, fields: fields, options: options};
  };

  return SchemaModel;
}

module.exports = schemaModelClassGenerator;