/**
 * Performs a database write operation.
 * @param {Mongo.Collection} collection The collection to write to.
 * @param {string} method The method ('insert', 'remove', 'update', 'upsert').
 * @param {Object} options The options for the write operation.
 * @return {Promise<any>} A promise that resolves with the result.
 */
function _write(collection, method, options) {
    switch (method) {
    case 'insert':
        return collection.insertAsync(options.selector);
    case 'remove':
        return collection.removeAsync(options.selector);
    case 'update':
        return collection.updateAsync(options.selector, options.modifier, options.options);
    case 'upsert':
        return collection.upsertAsync(options.selector, options.modifier, options.options);
    default:
        throw new Error(`Unknown method: ${method}`);
    }
}

export { _write };
