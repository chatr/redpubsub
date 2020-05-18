RPS.write = function (collection, method, options) {
    options = options || {};
    options.selector = options.selector ? Mongo.Collection._rewriteSelector(options.selector) : EJSON.clone(options.doc) || {};

    const _id = options.selector._id;
    const _idIsId = LocalCollection._selectorIsId(_id);
    const collectionName = collection._name;
    const config = RPS.config[collectionName] || {};
    const channels = !options.noPublish && (options.channels || config.channels || collectionName);

    let idMap = [];
    let docs = [];

    function publish (doc, id) {
        let channelsForDoc;
        if (_.isFunction(channels)) {
            channelsForDoc = channels(doc, options.selector, options.fields);
        } else {
            channelsForDoc = channels;
        }

        if (!channelsForDoc) return;

        const message = {
            _serverId: RPS._serverId,
            doc: method !== 'remove' && doc,
            method: method,
            selector: options.selector,
            modifier: options.redModifier || options.modifier,
            withoutMongo: options.withoutMongo,
            id: id || (doc && doc._id),
            ts: Date.now()
        };
        const messageString = JSON.stringify(message);

        _.each(_.isArray(channelsForDoc) ? channelsForDoc : [channelsForDoc], function (channel) {
            if (!channel) return;

            RPS._messenger.onMessage(channel, message);
            RPS._pub(channel, messageString);
        });
    }

    function afterWrite (res) {
        if (!channels) return res;

        if (options.withoutMongo) {
            const id = _idIsId ? _id : (method === 'insert' || method === 'upsert') && Random.id();
            publish(null, id);
        } else if (method === 'remove') {
             docs.forEach(function (doc) {
                publish(doc);
             });
        } else {
            if (idMap.length) {
                docs = collection.find({_id: {$in: idMap}});
            } else if (method === 'upsert' && res.insertedId) {
                docs = collection.find({_id: res.insertedId});
            } else if (method === 'insert') {
                const doc = options.selector;
                docs = [doc];
                idMap = [doc._id = doc._id || res]
            }

            docs && docs.forEach(function (doc) {
                publish(doc);
            });
        }

        return res;
    }

    if (options.noWrite) {
        publish(options.doc);
    } else {
        if (channels && method !== 'insert' && !options.withoutMongo) {
            const findOptions = {};

            if (method !== 'remove') {
                if (_idIsId) {
                    idMap.push(_id);
                } else {
                    findOptions.fields = {_id: 1};

                    if (!options.options || !options.options.multi) {
                        findOptions.limit = 1;
                    }
                }
            }

            if (!idMap.length) {
                collection.find(options.selector, findOptions).forEach(function (doc) {
                    idMap.push(doc._id);
                    docs.push(doc);
                });
            }

        }

        const callback = _.last(_.toArray(arguments));
        const async = _.isFunction(callback);

        if (async && !options.withoutMongo) {
            return RPS._write(collection, method, options, function (err, res) {
                if (!err) {
                    afterWrite(res);
                }
                callback(err, res);
            });
        } else {
            const res = !options.withoutMongo && RPS._write(collection, method, options);
            return afterWrite(res);
        }
    }
};
