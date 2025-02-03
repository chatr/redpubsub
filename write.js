/**
 * Internal function that performs a database write operation.
 * This function uses asynchronous methods on the collection.
 * @param {Mongo.Collection} collection The collection to write to.
 * @param {string} method The method to use ('insert', 'remove', 'update', 'upsert').
 * @param {Object} options Options for the write operation.
 * @return {Promise<any>} A promise resolving with the result of the operation.
 */
async function _write(collection, method, options) {
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
