RPS._write = function (collection, method, options, callback) {
    switch (method) {
        case 'insert':
        case 'remove':
            return collection[method](options.selector, callback);
            break;
        case 'update':
        case 'upsert':
            return collection[method](options.selector, options.modifier, options.options, callback);
            break;
    }
};