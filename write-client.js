RPS.write = function (collection, method, options) {
    //console.log('RPS.write; collection._name:', collection._name);

    options = options || {};
    options.selector = options.selector ? Mongo.Collection._rewriteSelector(options.selector) : options.doc || {};

    RPS._write(collection, method, options, options.callback);
};