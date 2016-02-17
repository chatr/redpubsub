RPS.write = function (collection, method, options) {
    //console.log('RPS.write; collection._name, method:', collection._name, method);

    options = options || {};
    options.selector = options.selector || options.doc;

    var callback = _.last(_.toArray(arguments)),
        async = _.isFunction(callback);

    return RPS._write(collection, method, options, async && callback);
};