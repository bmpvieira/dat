var protobuf = require('protocol-buffers');
var docUtils = require('./document.js')

var rawProtobuf = protobuf([{
  name: 'key',
  type: 'string',
  tag: 0
}, {
  name: 'version',
  type: 'string',
  tag: 1
}, {
  name: 'value',
  type: 'bytes',
  tag: 2
}, {
  name: 'deleted',
  type: 'bool',
  tag: 3
}])

var Schema = function(storage, onReady) {
  if (!(this instanceof Schema)) return new Schema(storage, onReady)
  this._storage = storage
  this.protobuf = null
  this.columns = []
  this.index = {}
  this.reserved = ['key', 'change', 'version', 'deleted']
  this.update(onReady)
}

Schema.prototype.update = function(cb) {
  var self = this
  this._storage.getMeta('schema', {valueEncoding:'json'}, function(err, schema) {
    if (err && err.notFound) err = null // grrrrr
    if (err) return cb(err)
    self.columns = schema || []
    self.compile()
    cb()
  });
}

Schema.prototype.compile = function() {
  var self = this

  this.protobuf = protobuf(this.columns)
  this.names = []

  this.columns.forEach(function(col) {
    self.names.push(col.name)
  })
}

Schema.prototype.save = function(cb) {
  this._storage.setMeta('schema', this.columns, {valueEncoding:'json'}, cb)
}

Schema.prototype.normalize = function(cols) {
  for (var i = 0; i < cols.length; i++) {
    if (typeof cols[i] === 'string') cols[i] = {name:cols[i], type:'json'}
    if (!cols[i]) cols[i].type = 'json'
  }
  return cols
}

Schema.prototype.encodeBinary = function(key, buf) {
  var doc = docUtils.decodeKey(key)
  return rawProtobuf.encode({
    key: key,
    deleted: !!doc.deleted,
    version: doc.version+'',
    value: buf
  })
}

Schema.prototype.decodeBinary = function(buf) {
  return rawProtobuf.decode(buf)
}

Schema.prototype.encode = function(doc) {
  return this.protobuf.encode(doc)
}

Schema.prototype.decode = function(buf) {
  return this.protobuf.decode(buf)
}

Schema.prototype.validate = function(doc) {
  return this.protobuf.validate(doc)
}

var mismatch = function() {
  var err = new Error('Column mismatch')
  err.type = 'columnMismatch'
  return err
}

Schema.prototype.mergeFromObject = function(obj, cb) {
  var keys = Object.keys(obj)
  var updated = 0

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i]
    var val = obj[key]

    if (val === null || val === undefined) continue
    if (this.reserved.indexOf(key) > -1) continue

    var idx = this.names.indexOf(key)
    if (idx === -1) {
      this.names.push(key)
      this.columns.push({name:key, type:'json'})
      updated++
    } else {
      // TODO: if type !== json type check
    }
  }

  if (!updated) return cb()

  this.compile()
  this.save(cb)
}

Schema.prototype.merge = function(cols, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = null
  }

  var updated = 0

  if (opts && opts.strict) {
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i]
      if (i >= this.columns.length) {
        if (!col.type) col.type = 'json'
        this.names.push(col.name)
        this.columns.push(col)
        updated++
      } else {
        if (col.type !== this.columns[i].type) return cb(mismatch())
        if (col.name !== this.columns[i].name) return cb(mismatch())
      }
    }
  } else {
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i]
      var idx = this.names.indexOf(col.name)
      if (idx === -1) {
        if (!col.type) col.type = 'json'
        this.names.push(col.name)
        this.columns.push(col)
        updated++
      } else {
        if (col.type !== this.columns[i].type) return cb(mismatch())
      }
    }
  }

  if (!updated) return cb()

  this.compile()
  this.save(cb)
}

Schema.prototype.toJSON = function() {
  return this.columns
}

module.exports = Schema