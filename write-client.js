import { _write } from './write';

/**
 * Performs a client-side write operation.
 * It wraps the _write function and sets the selector from doc if not provided.
 * @param {Mongo.Collection} collection The collection to write to.
 * @param {string} method The write method ('insert', 'remove', 'update', 'upsert').
 * @param {Object=} options Options for the write operation.
 * @return {Promise<any>} A promise that resolves with the result.
 */
async function write(collection, method, options = {}) {
    // For convenience, if no selector is provided, use options.doc.
    options.selector = options.selector || options.doc;
    return _write(collection, method, options);
}

export { write };
