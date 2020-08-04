RPS.write = function (collection, method, options) {
    options = options || {};
    options.selector = options.selector ? Mongo.Collection._rewriteSelector(options.selector) : EJSON.clone(options.doc) || {};

    const _id = options.selector._id;
    const _idIsId = !!_id;
    const collectionName = collection._name;
    const config = RPS.config[collectionName] || {};
    const channels = !options.noPublish && (options.channels || config.channels || collectionName);
    const channelsIsFuntion = _.isFunction(channels);
    const fields = options.fields || {};

    let idMap = [];
    let docs = [];

    function publish (doc, id) {
        let channelsForDoc;
        if (_.isFunction(channels)) {
            channelsForDoc = channels(doc, options.selector, fields);
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
        if (!channels || options.noPublish) return res;

        if (options.withoutMongo) {
            const id = _idIsId ? _id : (method === 'insert' || method === 'upsert') && Random.id();
            publish(null, id);
        } else {
            if (idMap.length) {
                idMap.forEach(function (id) {
                    publish(null, id);
                });
            } else if (method === 'upsert' && res.insertedId) {
                publish(collection.findOne({_id: res.insertedId}));
            } else if (method === 'insert') {
                const doc = options.selector;
                doc._id = doc._id || res;
                publish(doc);
            }
        }

        return res;
    }

    if (options.noWrite) {
        publish(options.doc);
    } else {
        if (channels && !options.noPublish && method !== 'insert' && !options.withoutMongo) {
            if (_idIsId) {
                idMap.push(_id);
            }

            const missedFields = channelsIsFuntion &&
                config.fetchFields &&
                _.difference(
                    config.fetchFields,
                    _.union(_.keys(options.selector), _.keys(fields))
                );

            if (missedFields && missedFields.length) {
                console.log('MISSED_FIELDS! collection._name, method, options, missedFields:', collection._name, method, options, missedFields);
            }

            if ((missedFields && missedFields.length) || !idMap.length) {
                const findOptions = {fields: {_id: 1}};

                missedFields && missedFields.forEach((field) => {
                    findOptions.fields[field] = 1;
                });

                if (!options.options || !options.options.multi) {
                    findOptions.limit = 1;
                }

                collection.find(options.selector, findOptions).forEach(function (doc, i) {
                    idMap.push(doc._id);
                    !i && _.extend(fields, doc);
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
