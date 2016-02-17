RPS._write = function (collection, method, options, callback) {
    //console.log('RPS._write; collection._name, method:', collection._name, method);

    switch (method) {
        case 'insert':
        case 'remove':
            return collection[method](options.selector, callback);
        case 'update':
        case 'upsert':
            return collection[method](options.selector, options.modifier, options.options, callback);
    }
};