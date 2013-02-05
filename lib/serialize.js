/*global require, exports */
"use strict";
var RE_FUNC = /function(.*?)\(/;
var toString = Object.prototype.toString;

function serialize(obj, stack) {
  var result = [];
  var type = (obj === null) ? 'null' : typeof obj;
  if (type != 'object') {
    //primitive
    return (obj == null) ? String(obj) : JSON.stringify(obj);
  }
  if (type == 'function') {
    return 'function(){}';
  }
  type = toString.call(obj).slice(8, -1);
  switch (type) {
    case 'Array':
      obj.forEach(function(obj) {
        result.push(serialize(obj, stack));
      });
      return '[' + result.join(',') + ']';
    case 'Date':
      return 'new Date(' + obj.valueOf() + ')';
    case 'RegExp':
      var flags = (obj.global ? 'g' : '') + (obj.ignoreCase ? 'i' : '') + (obj.multiline  ? 'm' : '');
      return 'new RegExp(' + JSON.stringify(obj.source) + ',"' + flags + '")';
  }
  var i = stack.indexOf(obj);
  if (i >= 0) {
    return 'r[' + i + ']';
  }
  stack.push(obj);
  var constructor = obj.constructor;
  if (!(obj instanceof constructor)) {
    return 'new Error("Invalid constructor")';
  }
  var name = constructor.name || (constructor.name = constructor.toString().match(RE_FUNC)[1].trim());
  Object.keys(obj).forEach(function(n) {
    if (n == '__proto__') return;
    result.push(JSON.stringify(n) + ':' + serialize(obj[n], stack));
  });
  result = '{' + result.join(',') + '}';
  return (constructor === Object) ? result : 'c(' + (JSON.stringify(name)) + ',' + result + ')';
}

exports.serialize = function(obj) {
  var stack = [];
  return [
    'function revive($) {',
    'var r = [], fn = function() {}, create = function(o) { fn.prototype = o; return new fn }, extend = function(d, s) { Object.keys(s).forEach(function(n) { d[n] = s[n] }); return d}, c = function(n, p) { var o = extend(create($[n].prototype), p); r.push(o); return o };',
    'return ' + serialize(obj, stack),
    '}'
  ].join('');
};
