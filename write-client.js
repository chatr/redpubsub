RPS.write = function (collection, method, options) {
    options = options || {};
    options.selector = options.selector || options.doc;

    const callback = _.last(_.toArray(arguments));
    const async = _.isFunction(callback);

    return RPS._write(collection, method, options, async && callback);
};