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
    options.selector = options.selector
        ? Mongo.Collection._rewriteSelector(options.selector)
        : options.doc || {};

    const { _id } = options.selector;
    const _idIsId = !!_id && typeof _id === 'string';
    const collectionName = collection._name;
    const config = RPS.config[collectionName] || {};
    const channels = !options.noPublish && (options.channels || config.channels || collectionName);

    let idMap = [];
    let docs = [];

    async function publish(doc, id) {
        let channelsForDoc;
        if (typeof channels === 'function') {
            channelsForDoc = channels(doc, options.selector, options.fields);
        } else {
            channelsForDoc = channels;
        }

        if (!channelsForDoc) {
            return;
        }

        const message = {
            _serverId: serverId,
            doc: method !== 'remove' && doc,
            method,
            selector: options.selector,
            modifier: options.redModifier || options.modifier,
            withoutMongo: options.withoutMongo,
            id: id || (doc && doc._id),
            ts: Date.now(),
        };
        const messageString = JSON.stringify(message);

        (Array.isArray(channelsForDoc) ? channelsForDoc : [channelsForDoc]).forEach((channel) => {
            if (!channel) {
                return;
            }

            messenger.handleMessage(channel, message);
            publishMessage(channel, messageString);
        });
    }

    async function afterWrite(res) {
        if (!channels) {
            return res;
        }

        if (options.withoutMongo) {
            const id = _idIsId ? _id : (method === 'insert' || method === 'upsert') && Random.id();
            await publish(null, id);
        } else if (method === 'remove') {
            for (const doc of docs) {
                await publish(doc);
            }
        } else {
            if (idMap.length) {
                const cursor = collection.find({ _id: { $in: idMap } });
                docs = await cursor.fetchAsync();
            } else if (method === 'upsert' && res.insertedId) {
                const cursor = collection.find({ _id: res.insertedId });
                docs = await cursor.fetchAsync();
            } else if (method === 'insert') {
                const doc = options.selector;
                docs = [doc];
                idMap = [doc._id = doc._id || res];
            }

            for (const doc of docs) {
                await publish(doc);
            }
        }

        return res;
    }

    if (options.noWrite) {
        await publish(options.doc);
        return void 0;
    }

    if (channels && method !== 'insert' && !options.withoutMongo) {
        const findOptions = {};

        if (method !== 'remove') {
            if (_idIsId) {
                idMap.push(_id);
            } else {
                findOptions.fields = { _id: 1 };

                if (!options.options || !options.options.multi) {
                    findOptions.limit = 1;
                }
            }
        }

        if (idMap.length === 0) {
            const cursor = collection.find(options.selector, findOptions);
            const foundDocs = await cursor.fetchAsync();

            for (const doc of foundDocs) {
                idMap.push(doc._id);
                docs.push(doc);
            }
        }
    }

    const res = !options.withoutMongo && (await _write(collection, method, options));
    return afterWrite(res);
}

export { write };
