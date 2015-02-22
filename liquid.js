/*global require, exports */
(function(require, exports) {
  "use strict";

  function Tag(tagName, markup, tokens) {
    this.tagName = tagName;
    this.nodelist = this.nodelist || [];
    this.parse(tokens);
  }

  extend(Tag.prototype, {
    parse: function(tokens) {
    },
    render: function(context) {
      return '';
    }
  });

  function Block(tagName, markup, tokens) {
    this.blockName = tagName;
    this.blockDelimiter = "end" + this.blockName;
    Tag.apply(this, arguments);
  }

  inherits(Block, Tag);

  extend(Block.prototype, {
    parse: function(tokens) {
      if (!this.nodelist) this.nodelist = [];
      this.nodelist.length = 0;

      var token = tokens.shift();
      tokens.push(''); // To ensure we don't lose the last token passed in...
      while (tokens.length) {

        if (/^\{\%/.test(token)) { // It's a tag...
          var tagParts = token.match(/^\{\%\s*(\w+)\s*(.*)?\%\}$/);

          if (tagParts) {
            if (this.blockDelimiter == tagParts[1]) {
              this.endTag();
              return;
            }
            if (tagParts[1] in Template.tags) {
              this.nodelist.push(new Template.tags[tagParts[1]](tagParts[1], tagParts[2], tokens));
            } else {
              this.unknownTag(tagParts[1], tagParts[2], tokens);
            }
          } else {
            throw new Error( "Tag '" + token + "' was not properly terminated with: %}");
          }
        } else
        if (/^\{\{/.test(token)) { // It's a variable...
          this.nodelist.push(this.createVariable(token));
        } else { //if(token != '') {
          this.nodelist.push(token);
        } // Ignores tokens that are empty
        token = tokens.shift(); // Assign the next token to loop again...
      }

      this.assertMissingDelimitation();
    },

    endTag: function() {
    },

    unknownTag: function(tag, params, tokens) {
      switch (tag) {
        case 'else':
          throw new Error(this.blockName + " tag does not expect else tag");
          break;
        case 'end':
          throw new Error("'end' is not a valid delimiter for " + this.blockName + " tags. use " + this.blockDelimiter);
          break;
        default:
          throw new Error("Unknown tag: " + tag);
      }
    },

    createVariable: function(token) {
      var match = token.match(/^\{\{(.*)\}\}$/);
      if (match) {
        return new Variable(match[1]);
      }
      else {
        throw new Error("Variable '" + token + "' was not properly terminated with: }}");
      }
    },

    render: function(context) {
      return this.renderAll(this.nodelist, context);
    },

    renderAll: function(list, context) {
      return (list || []).map(function(token, i) {
        return ( token['render'] ) ? token.render(context) : token;
      });
    },

    assertMissingDelimitation: function() {
      throw new Error(this.blockName + " tag was never closed");
    }
  });

  function Document(tokens) {
    this.blockDelimiter = []; // [], really?
    this.parse(tokens);
  }

  inherits(Document, Block);

  extend(Document.prototype, {
    assertMissingDelimitation: function() {
    }
  });

  function Strainer(context) {
    this.context = context;
  }

  extend(Strainer.prototype, {
    respondTo: function(methodName) {
      methodName = methodName.toString();
      if (methodName.match(/^__/)) return false;
      if (~Strainer.requiredMethods.indexOf(methodName)) return false;
      return (methodName in this);
    }
  });

  Strainer.filters = {};

  Strainer.globalFilter = function(filters) {
    for (var f in filters) {
      Strainer.filters[f] = filters[f];
    }
  };

  Strainer.requiredMethods = ['respondTo', 'context'];

  Strainer.create = function(context) {
    var strainer = new Strainer(context);
    for (var f in Strainer.filters) {
      strainer[f] = Strainer.filters[f];
    }
    return strainer;
  };

  function Context(assigns, registers) {
    this.scopes = [assigns ? assigns : {}];
    this.registers = registers ? registers : {};
    this.strainer = Strainer.create(this);
  }

  extend(Context.prototype, {
    get: function(varname) {
      return this.resolve(varname);
    },

    set: function(varname, value) {
      this.scopes[0][varname] = value;
    },

    hasKey: function(key) {
      return (this.resolve(key)) ? true : false;
    },

    push: function() {
      var scpObj = {};
      this.scopes.unshift(scpObj);
      return scpObj // Is this right?
    },

    merge: function(newScope) {
      return extend(this.scopes[0], newScope);
    },

    pop: function() {
      if (this.scopes.length == 1) {
        throw "Context stack error";
      }
      return this.scopes.shift();
    },

    stack: function(lambda, bind) {
      var result = null;
      this.push();
      try {
        result = lambda.apply(bind ? bind : this.strainer);
      } finally {
        this.pop();
      }
      return result;
    },

    invoke: function(method, args) {
      if (this.strainer.respondTo(method)) {
        return this.strainer[method].apply(this.strainer, args);
      } else {
        return (args.length == 0) ? null : args[0]; // was: $pick
      }
    },

    resolve: function(key) {
      switch (key) {
        case null:
        case 'nil':
        case 'null':
        case '':
          return null;
        case 'true':
          return true;
        case 'false':
          return false;
        case 'blank':
        case 'empty':
          return '';
      }
      if ((/^'(.*)'$/).test(key)) {
        return key.replace(/^'(.*)'$/, '$1');
      } else
      if ((/^"(.*)"$/).test(key)) {
        return key.replace(/^"(.*)"$/, '$1');
      } else
      if ((/^(\d+)$/).test(key)) {
        //integer
        return parseInt(key, 10);
      } else
      if ((/^(\d[\d\.]+)$/).test(key)) {
        //float
        return parseFloat(key);
      } else {
        return this.variable(key);
      }
    },

    findVariable: function(key) {
      for (var i = 0; i < this.scopes.length; i++) {
        var scope = this.scopes[i];
        if (scope && typeof(scope[key]) !== 'undefined') {
          var variable = scope[key];
          if (typeof(variable) == 'function') {
            variable = variable.apply(this);
            scope[key] = variable;
          }
          if (variable && typeof(variable) == 'object' && ('toLiquid' in variable)) {
            variable = variable.toLiquid();
          }
          if (variable && typeof(variable) == 'object' && ('setContext' in variable)) {
            variable.setContext(self);
          }
          return variable;
        }
      }
      return null;
    },

    variable: function(markup) {
      if (typeof markup != 'string') {
        return null;
      }

      var parts = markup.match(/\[[^\]]+\]|(?:[\w\-]\??)+/g),
        firstPart = parts.shift(),
        squareMatch = firstPart.match(/^\[(.*)\]$/);

      if (squareMatch) {
        firstPart = this.resolve(squareMatch[1]);
      }

      var object = this.findVariable(firstPart),
        self = this;

      if (object) {
        parts.forEach(function(part) {
          var squareMatch = part.match(/^\[(.*)\]$/);
          if (squareMatch) {
            var part = self.resolve(squareMatch[1]);
            if (typeof(object[part]) == 'function') {
              object[part] = object[part].apply(this);
            }// Array?
            object = object[part];
            if (typeof(object) == 'object' && ('toLiquid' in object)) {
              object = object.toLiquid();
            }
          } else {
            if ((typeof(object) == 'object' || typeof(object) == 'hash') && (part in object)) {
              var res = object[part];
              if (typeof(res) == 'function') {
                res = object[part] = res.apply(self);
              }
              if (typeof(res) == 'object' && ('toLiquid' in res)) {
                object = res.toLiquid();
              }
              else {
                object = res;
              }
            } else
            if ((/^\d+$/).test(part)) {
              var pos = parseInt(part, 10);
              if (typeof(object[pos]) == 'function') {
                object[pos] = object[pos].apply(self);
              }
              if (typeof(object[pos]) == 'object' && typeof(object[pos]) == 'object' && ('toLiquid' in object[pos])) {
                object = object[pos].toLiquid();
              }
              else {
                object = object[pos];
              }
            } else
            //todo: this might be where we determine if an object has the given method
            if (object && typeof(object[part]) == 'function' && (part in {length: 1, size: 1, first: 1, last: 1})) {
              object = object[part].apply(part);
              if ('toLiquid' in object) {
                object = object.toLiquid();
              }
            } else {
              return object = null;
            }
            if (typeof(object) == 'object' && ('setContext' in object)) {
              object.setContext(self);
            }
          }
        });
      }
      return object;
    },

    addFilters: function(filters) {
      filters.forEach(function(filter) {
        if (typeof(filter) != 'object') {
          throw new Error("Expected object but got: " + typeof(filter))
        }
        this.strainer.addMethods(filter);
      });
    }
  });

  function Template() {
    this.root = null;
    this.registers = {};
    this.assigns = {};
  }

  extend(Template.prototype, {
    parse: function(src) {
      this.root = new Document(Template.tokenize(src));
      return this;
    },

    render: function(ctx, filters, registers) {
      if (!this.root) {
        return '';
      }
      var context;

      if (ctx instanceof Context) {
        context = ctx;
        this.assigns = context.assigns;
        this.registers = context.registers;
      } else {
        if (ctx) {
          extend(this.assigns, ctx);
        }
        if (registers) {
          extend(this.registers, registers);
        }
        context = new Context(this.assigns, this.registers)
      }

      if (filters) {
        context.addFilters(filters);
      }

      return this.root.render(context).join('');
    }
  });


  Template.tags = {};

  Template.registerTag = function(name, tagClass) {
    Template.tags[name] = tagClass;
  };

  Template.registerFilter = function(filters) {
    Strainer.globalFilter(filters)
  };

  Template.tokenize = function(src) {
    //var tokens = src.split(/(\{\%.*?\%\}|\{\{.*?\}\})/);
    var tagStart, tagEnd, prevEnd = 0, tokens = [];
    while ((tagStart = src.indexOf('{', prevEnd)) >= 0) {
      tagEnd = -1;
      if (src.charAt(tagStart + 1) == '%') {
        tagEnd = src.indexOf('%}', tagStart + 2);
      } else
      if (src.charAt(tagStart + 1) == '{') {
        tagEnd = src.indexOf('}}', tagStart + 2);
      }
      if (tagEnd < 0) {
        prevEnd ++;
        continue;
      }
      tokens.push(src.slice(prevEnd, tagStart));
      tokens.push(src.slice(tagStart, tagEnd + 2));
      prevEnd = tagEnd + 2;
    }
    tokens.push(src.slice(prevEnd));
    if (tokens[0] == '') {
      tokens.shift();
    }
    return tokens;
  };

  Template.parse = function(src) {
    return new Template().parse(src);
  };


  function Variable(markup) {
    this.name = null;
    this.filters = [];
    var self = this;
    var match = markup.match(/\s*("[^"]+"|'[^']+'|[^\s,|]+)/);
    if (match) {
      this.name = match[1];
      var filterMatches = markup.match(/\|\s*(.*)/);
      if (filterMatches) {
        var filters = filterMatches[1].split(/\|/);
        filters.forEach(function(f) {
          var matches = f.match(/\s*(\w+)/);
          if (matches) {
            var filterName = matches[1];
            var filterArgs = [];
            (f.match(/(?:[:|,]\s*)("[^"]+"|'[^']+'|[^\s,|]+)/g) || []).forEach(function(arg) {
              var cleanupMatch = arg.match(/^[\s|:|,]*(.*?)[\s]*$/);
              if (cleanupMatch) {
                filterArgs.push(cleanupMatch[1]);
              }
            });
            self.filters.push([filterName, filterArgs]);
          }
        });
      }
    }
  }

  extend(Variable.prototype, {
    render: function(context) {
      if (this.name == null) {
        return '';
      }
      var output = context.get(this.name);
      this.filters.forEach(function(filter) {
        var filterName = filter[0],
          filterArgs = (filter[1] || []).map(function(arg) {
            return context.get(arg);
          });
        filterArgs.unshift(output); // Push in input value into the first argument spot...
        output = context.invoke(filterName, filterArgs);
      });

      return output;
    }
  });

  function Condition(left, operator, right) {
    this.left = left;
    this.operator = operator;
    this.right = right;
    this.childRelation = null;
    this.childCondition = null;
    this.attachment = null;
  }

  extend(Condition.prototype, {
    evaluate: function(context) {
      context = context || new Context();
      var result = this.interpretCondition(this.left, this.right, this.operator, context);
      switch (this.childRelation) {
        case 'or':
          return (result || this.childCondition.evaluate(context));
        case 'and':
          return (result && this.childCondition.evaluate(context));
        default:
          return result;
      }
    },

    or: function(condition) {
      this.childRelation = 'or';
      this.childCondition = condition;
    },

    and: function(condition) {
      this.childRelation = 'and';
      this.childCondition = condition;
    },

    attach: function(attachment) {
      this.attachment = attachment;
      return this.attachment;
    },

    isElse: false,

    interpretCondition: function(left, right, op, context) {
      if (!op) {
        return context.get(left);
      }

      left = context.get(left);
      right = context.get(right);
      op = Condition.operators[op];
      if (!op) {
        throw new Error("Unknown operator " + op);
      }

      return op(left, right);
    },

    toString: function() {
      return "<Condition " + this.left + " " + this.operator + " " + this.right + ">";
    }
  });

  Condition.operators = {
    '==': function(l, r) {
      return (l == r);
    },
    '=': function(l, r) {
      return (l == r);
    },
    '!=': function(l, r) {
      return (l != r);
    },
    '<>': function(l, r) {
      return (l != r);
    },
    '<': function(l, r) {
      return (l < r);
    },
    '>': function(l, r) {
      return (l > r);
    },
    '<=': function(l, r) {
      return (l <= r);
    },
    '>=': function(l, r) {
      return (l >= r);
    },
    'contains': function(l, r) {
      return l.indexOf(r) >= 0;
    },
    'hasKey': function(l, r) {
      return (Object.keys(l).indexOf(r) >= 0);
    },
    'hasValue': function(l, r) {
      return (r in l);
    }
  };


  function ElseCondition() {
  }

  inherits(ElseCondition, Condition);

  extend(ElseCondition.prototype, {
    isElse: true,
    evaluate: function(context) {
      return true;
    },
    toString: function() {
      return "<ElseCondition>";
    }
  });

  function Drop() {

  }

  extend(Drop.prototype, {
    setContext: function(context) {
      this.context = context;
    },
    beforeMethod: function(method) {

    },
    invokeDrop: function(method) {
      var results = this.beforeMethod();
      if (!results && (method in this)) {
        results = this[method].apply(this);
      }
      return results;
    },
    hasKey: function(name) {
      return true;
    }
  });

  function AssignTag(tagName, markup, tokens) {
    var parts = markup.match(this.tagSyntax);
    if (parts) {
      this.to = parts[1];
      this.from = parts[2];
    } else {
      throw new Error("Syntax error in 'assign' - Valid syntax: assign [var] = [source]");
    }
    Tag.apply(this, arguments)
  }

  inherits(AssignTag, Tag);

  extend(AssignTag.prototype, {
    tagSyntax: /((?:\(?[\w\-\.\[\]]\)?)+)\s*=\s*((?:"[^"]+"|'[^']+'|[^\s,|]+)+)/,
    render: function(context) {
      var last = context.scopes[context.scopes.length - 1];
      last[this.to.toString()] = context.get(this.from);
      return '';
    }
  });

  function IncludeTag(tag, markup, tokens) {
    var matches = (markup || '').match(this.tagSyntax);
    if (matches) {
      this.templateName = matches[1];
      this.templateNameVar = this.templateName.substring(1, this.templateName.length - 1);
      this.variableName = matches[3];
      this.attributes = {};

      var attMatchs = markup.match(/(\w*?)\s*\:\s*("[^"]+"|'[^']+'|[^\s,|]+)/g);
      if (attMatchs) {
        attMatchs.forEach(function(pair) {
          pair = pair.split(':');
          this.attributes[pair[0].trim()] = pair[1].trim();
        }, this);
      }
    } else {
      throw new Error("Error in tag 'include' - Valid syntax: include '[template]' (with|for) [object|collection]");
    }
    Tag.apply(this, arguments);
  }

  inherits(IncludeTag, Tag);

  extend(IncludeTag.prototype, {
    tagSyntax: /((?:"[^"]+"|'[^']+'|[^\s,|]+)+)(\s+(?:with|for)\s+((?:"[^"]+"|'[^']+'|[^\s,|]+)+))?/,

    render: function(context) {
      var self = this,
        source = exports.readTemplateFile(context.get(this.templateName)),
        partial = exports.parse(source),
        variable = context.get((this.variableName || this.templateNameVar)),
        output = '';
      context.stack(function() {
        //todoL: self.attributes.each = hackObjectEach;
        Object.keys(self.attributes).forEach(function(key) {
          var value = self.attributes[key];
          context.set(key, context.get(value));
        });

        if (variable instanceof Array) {
          output = variable.map(function(variable) {
            context.set(self.templateNameVar, variable);
            return partial.render(context);
          });
        } else {
          context.set(self.templateNameVar, variable);
          output = partial.render(context);
        }
      });
      return flatten([output]).join('');
    }
  });

  function CommentBlock() {

  }

  inherits(CommentBlock, Block);

  extend(CommentBlock.prototype, {
    render: function(context) {
      return '';
    }
  });

  function BlockBlock() {
    Block.apply(this, arguments);
  }

  inherits(BlockBlock, Block);

  extend(BlockBlock.prototype, {
    render: function(context) {
      return '';
    }
  });

  function ForBlock(tag, markup, tokens) {
    var matches = markup.match(this.tagSyntax);
    if (matches) {
      this.variableName = matches[1];
      this.collectionName = matches[2];
      this.name = this.variableName + "-" + this.collectionName;
      this.attributes = {};
      var attrmarkup = markup.replace(this.tagSyntax, '');
      var attMatchs = markup.match(/(\w*?)\s*\:\s*("[^"]+"|'[^']+'|[^\s,|]+)/g);
      if (attMatchs) {
        attMatchs.forEach(function(pair) {
          pair = pair.split(':');
          this.attributes.set[pair[0].trim()] = pair[1].trim();
        }, this);
      }
    } else {
      throw new Error("Syntax error in 'for loop' - Valid syntax: for [item] in [collection]");
    }
    Block.apply(this, arguments);
  }

  inherits(ForBlock, Block);

  extend(ForBlock.prototype, {
    tagSyntax: /(\w+)\s+in\s+((?:\(?[\w\-\.\[\]]\)?)+)/,

    render: function(context) {
      var self = this,
        output = [],
        collection = (context.get(this.collectionName) || []),
        range = [0, collection.length];

      if (!context.registers['for']) {
        context.registers['for'] = {};
      }

      if (this.attributes['limit'] || this.attributes['offset']) {
        var offset = 0;

        if (this.attributes['offset'] == 'continue') {
          offset = context.registers['for'][this.name];
        }
        else {
          offset = context.get(this.attributes['offset']) || 0;
        }

        var limit = context.get(this.attributes['limit']);

        var rangeEnd = (limit) ? offset + limit + 1 : collection.length;
        range = [offset, rangeEnd - 1];

        context.registers['for'][this.name] = rangeEnd;
      }

      var segment = collection.slice(range[0], range[1]);
      if (!segment || segment.length == 0) {
        return '';
      }

      context.stack(function() {
        var length = segment.length;

        segment.forEach(function(item, index) {
          context.set(self.variableName, item);
          context.set('forloop', {
            name: self.name,
            length: length,
            index: (index + 1),
            index0: index,
            rindex: (length - index),
            rindex0: (length - index - 1),
            first: (index == 0),
            last: (index == (length - 1))
          });
          output.push((self.renderAll(self.nodelist, context) || []).join(''));
        });
      });

      return flatten([output]).join('');
    }
  });

  function IfBlock(tag, markup, tokens) {
    this.nodelist = [];
    this.blocks = [];
    this.pushBlock('if', markup);
    Block.apply(this, arguments);
  }

  inherits(IfBlock, Block);

  extend(IfBlock.prototype, {
    tagSyntax: /("[^"]+"|'[^']+'|[^\s,|]+)\s*([=!<>a-z_]+)?\s*("[^"]+"|'[^']+'|[^\s,|]+)?/,

    unknownTag: function(tag, markup, tokens) {
      if (tag == 'elsif' || tag == 'else') {
        this.pushBlock(tag, markup);
      } else {
        Block.apply(this, arguments);
      }
    },

    render: function(context) {
      var self = this,
        output = '';
      context.stack(function() {
        for (var i = 0; i < self.blocks.length; i++) {
          var block = self.blocks[i];
          if (block.evaluate(context)) {
            output = self.renderAll(block.attachment, context);
            return;
          }
        }
      });
      return flatten([output]).join('');
    },

    pushBlock: function(tag, markup) {
      var block;
      if (tag == 'else') {
        block = new ElseCondition();
      } else {
        var expressions = markup.split(/\b(and|or)\b/).reverse(),
          expMatches = expressions.shift().match(this.tagSyntax);

        if (!expMatches) {
          throw new Error("Syntax Error in tag '" + tag + "' - Valid syntax: " + tag + " [expression]");
        }

        var condition = new Condition(expMatches[1], expMatches[2], expMatches[3]);

        while (expressions.length > 0) {
          var operator = expressions.shift(),
            expMatches = expressions.shift().match(this.tagSyntax);
          if (!expMatches) {
            throw new Error("Syntax Error in tag '" + tag + "' - Valid syntax: " + tag + " [expression]");
          }

          var newCondition = new Condition(expMatches[1], expMatches[2], expMatches[3]);
          newCondition[operator](condition);
          condition = newCondition;
        }

        block = condition;
      }
      block.attach([]);
      this.blocks.push(block);
      this.nodelist = block.attachment;
    }
  });


  Template.registerTag('assign', AssignTag);

  Template.registerTag('include', IncludeTag);

  Template.registerTag('comment', CommentBlock);

  Template.registerTag('block', BlockBlock);

  Template.registerTag('for', ForBlock);

  Template.registerTag('if', IfBlock);

  Template.registerFilter({
    html: function(val) {
      return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  });

  //export classes
  exports.Tag = Tag;
  exports.Block = Block;
  exports.Document = Document;
  exports.Strainer = Strainer;
  exports.Context = Context;
  exports.Template = Template;
  exports.Variable = Variable;
  exports.Condition = Condition;
  exports.ElseCondition = ElseCondition;
  exports.Drop = Drop;
  exports.AssignTag = AssignTag;
  exports.IncludeTag = IncludeTag;
  exports.CommentBlock = CommentBlock;
  exports.BlockBlock = BlockBlock;
  exports.ForBlock = ForBlock;
  exports.IfBlock = IfBlock;

  //export methods
  exports.readTemplateFile = function(path) {
    throw new Error("This liquid context does not allow includes.");
    //return '';
  };

  exports.parse = function(src) {
    return Template.parse(src);
  };


  function flatten(arr) {
    var len = arr.length, flat = [];
    for (var i = 0; i < len; i++) {
      if (arr[i] instanceof Array) {
        flat = flat.concat(arr[i]);
      } else {
        flat.push(arr[i]);
      }
    }
    return flat;
  }

  function extend(dest) {
    var len = arguments.length;
    for (var i = 1; i < len; i++) {
      var src = arguments[i];
      if (!src) continue;
      Object.keys(src).forEach(function(key) {
        dest[key] = src[key];
      });
    }
    return dest;
  }

  function inherits(ctor, parent) {
    ctor.super_ = parent;
    ctor.prototype = Object.create(parent.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  }

})(require, exports);