import { Random } from 'meteor/random';
import { Mongo } from 'meteor/mongo';
import { _write } from './write';
import { serverId, publishMessage } from './redis';
import { RPS } from './main-server';
import { messenger } from './messenger';

/**
 * Performs a server-side write operation and publishes changes.
 * @param {Mongo.Collection} collection The collection to write to.
 * @param {string} method The method ('insert', 'remove', 'update', 'upsert').
 * @param {Object=} options The options for the write operation.
 * @return {Promise<any>} A promise that resolves with the result.
 */
async function write(collection, method, options = {}) {
    // If a selector is provided in options, rewrite it; otherwise, use the document from options.
    options.selector = options.selector
        ? Mongo.Collection._rewriteSelector(options.selector)
        : options.doc || {};

    // Destructure _id from the selector.
    const { _id } = options.selector;
    // Determine if _id is a non-empty string.
    const _idIsId = !!_id && typeof _id === 'string';
    // Get the collection name.
    const collectionName = collection._name;
    // Retrieve configuration for this collection, or use an empty object if none exists.
    const config = RPS.config[collectionName] || {};
    // Determine the channels for publishing. If noPublish is true, channels will be false.
    // Otherwise, use options.channels, or the channels defined in the config, or default to the collection name.
    const channels = !options.noPublish && (options.channels || config.channels || collectionName);

    // Arrays to store document IDs and documents for later publishing
    let idMap = [];
    let docs = [];

    // Async function to publish a message to all determined channels for a document
    async function publish(doc, id) {
        let channelsForDoc;
        // If channels is a function, call it to determine channels based on the document, selector, and fields.
        if (typeof channels === 'function') {
            channelsForDoc = channels(doc, options.selector, options.fields);
        } else {
            channelsForDoc = channels;
        }
        // If no channels are returned, skip publishing.
        if (!channelsForDoc) {
            return;
        }
        // Build the message object to send.
        const message = {
            _serverId: serverId, // Identifier for the server sending the message.
            doc: method !== 'remove' && doc, // Include the document unless the method is 'remove'.
            method, // The write method (e.g., insert, update, remove).
            selector: options.selector, // The selector used in the write operation.
            modifier: options.redModifier || options.modifier, // Modifier used for update operations.
            withoutMongo: options.withoutMongo, // Indicates if MongoDB is bypassed.
            id: id || (doc && doc._id), // Use the provided id, or extract from the document.
            ts: Date.now(), // Timestamp for the message.
        };
        // Serialize the message to a JSON string for transmission.
        const messageString = JSON.stringify(message);
        // Ensure channelsForDoc is in array form (even if a single channel is returned).
        const channelsArray = Array.isArray(channelsForDoc) ? channelsForDoc : [channelsForDoc];

        // Publish the message to each channel.
        channelsArray.forEach((channel) => {
            if (!channel) {
                return;
            }
            // Handle the message through the messenger.
            messenger.handleMessage(channel, message);
            // Send out the message string via publishMessage.
            publishMessage(channel, messageString);
        });
    }

    // Async function to be called after the write operation,
    // which handles the publishing of changes.
    async function afterWrite(result) {
        // If channels are not configured, skip publishing and return the result immediately.
        if (!channels) {
            return result;
        }
        // If the write is done without MongoDB, publish using a generated or provided id.
        if (options.withoutMongo) {
            // Generate an id if necessary: use _id if it's a valid string or generate a random id for insert/upsert.
            const id = _idIsId ? _id : ((method === 'insert' || method === 'upsert') && Random.id());
            await publish(null, id);
        } else if (method === 'remove') {
            // If the method is 'remove', publish each document in parallel.
            await Promise.all(docs.map((doc) => publish(doc)));
        } else {
            // For other methods (insert, update, upsert), fetch the latest documents to publish.
            if (idMap.length) {
                // Fetch documents with ids in idMap.
                const cursor = collection.find({ _id: { $in: idMap } });
                docs = await cursor.fetchAsync();
            } else if (method === 'upsert' && result.insertedId) {
                // For upsert, if an insertedId is provided, fetch that document.
                const cursor = collection.find({ _id: result.insertedId });
                docs = await cursor.fetchAsync();
            } else if (method === 'insert') {
                // For insert, use the selector as the document and update idMap accordingly.
                const doc = options.selector;
                docs = [doc];
                idMap = [doc._id = doc._id || result];
            }
            // Publish all the documents concurrently.
            await Promise.all(docs.map((doc) => publish(doc)));
        }
        // Return the result from the write operation after publishing is complete.
        return result;
    }

    // If the noWrite option is set, skip the write operation and only publish the provided document.
    if (options.noWrite) {
        await publish(options.doc);
        return void 0;
    }

    // Pre-fetch document ids and documents for publishing if channels are configured,
    // the method is not 'insert', and MongoDB write is not bypassed.
    if (channels && method !== 'insert' && !options.withoutMongo) {
        const findOptions = {};
        if (method !== 'remove') {
            if (_idIsId) {
                // If a valid _id exists, add it directly to the idMap.
                idMap.push(_id);
            } else {
                // Otherwise, set findOptions to fetch only the _id field.
                findOptions.fields = { _id: 1 };
                // If the update is not multi, limit the query to 1 document.
                if (!options.options || !options.options.multi) {
                    findOptions.limit = 1;
                }
            }
        }
        // If idMap is empty, perform a query to fetch the documents matching the selector.
        if (idMap.length === 0) {
            const cursor = collection.find(options.selector, findOptions);
            const foundDocs = await cursor.fetchAsync();
            for (const doc of foundDocs) {
                idMap.push(doc._id);
                docs.push(doc);
            }
        }
    }

    // If withoutMongo is set, skip the actual database write and directly publish.
    if (options.withoutMongo) {
        return afterWrite(void 0);
    }

    // Perform the actual write operation (insert, update, remove, etc.)
    const writeResult = await _write(collection, method, options);
    // After the write, call afterWrite to handle publishing and then return the result.
    return afterWrite(writeResult);
}

export { write };
