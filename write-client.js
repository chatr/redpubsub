RPS.write = function (collection, method, options) {
    //console.log('RPS.write; collection._name:', collection._name);

    options = options || {};
    options.selector = options.selector || options.doc;

    return RPS._write(collection, method, options, _.last(_.toArray(arguments)));
};