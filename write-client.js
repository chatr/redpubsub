import { _write } from './write';

/**
 * Performs a client-side write operation.
 * @param {Mongo.Collection} collection The collection to write to.
 * @param {string} method The method ('insert', 'remove', 'update', 'upsert').
 * @param {Object=} options The options for the write operation.
 * @return {Promise<any>} A promise that resolves with the result.
 */
function write(collection, method, options = {}) {
    options.selector = options.selector || options.doc;
    return _write(collection, method, options);
}

export { write };
