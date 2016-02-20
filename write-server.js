RPS.write = function (collection, method, options) {
    options = options || {};
    options.selector = options.selector ? Mongo.Collection._rewriteSelector(options.selector) : options.doc || {};

    var collectionName = collection._name,
        config = RPS.config[collectionName] || {},
        channels = !options.noPublish && (options.channels || config.channels || collectionName),
        channelsIsFunction = _.isFunction(channels),
        idMap = [],
        docs = [];

    //console.log('RPS.write; collectionName, method, options:', collectionName, method, options, channels);

    var publish = function (doc, id) {
        var channelsForDoc;
        if (channelsIsFunction) {
            channelsForDoc = channels(doc, options.selector, options.fields);
        } else {
            channelsForDoc = channels;
        }

        //console.log('RPS.write → publish; doc, id, channels:', doc, id, channels);

        if (!channelsForDoc) return;

        var message = {
            _serverId: RPS._serverId,
            doc: method !== 'remove' && doc,
            method: method,
            selector: options.selector,
            modifier: options.modifier,
            withoutMongo: options.withoutMongo,
            id: id || (doc && doc._id),
            ts: Date.now()
        },
        messageString = JSON.stringify(message);

        _.each(_.isArray(channelsForDoc) ? channelsForDoc : [channelsForDoc], function (channel) {
            if (!channel) return;

            RPS._messenger.onMessage(channel, message);
            RPS._pub(channel, messageString);
        });
    };

    var afterWrite = function (res) {
        if (!channels) return res;

        if (options.withoutMongo) {
            var _id = options.selector._id,
                id = LocalCollection._selectorIsId(_id) ? _id : Random.id();
            publish(null, id);
        } else if (method === 'remove') {
             docs.forEach(function (doc) {
                publish(doc);
             });
        } else {
            if (idMap && idMap.length) {
                docs = collection.find({_id: {$in: idMap}});
            } else if (method === 'upsert' && res.insertedId) {
                docs = collection.find({_id: res.insertedId});
            } else if (method === 'insert') {
                var doc = options.selector;
                docs = [doc];
                idMap = [doc._id = doc._id || res]
            }

            docs && docs.forEach(function (doc) {
                publish(doc);
            });
        }

        return res;
    };

    if (options.noWrite) {
        publish(options.doc);
    } else {
        if (channels && method !== 'insert' && !options.withoutMongo) {
            var findOptions = {};

            if (method !== 'remove') {
                findOptions.fields = {_id: 1};
            }

            if (method !== 'remove' && (!options.options || !options.options.multi)) {
                findOptions.limit = 1;
            }

            collection.find(options.selector, findOptions).forEach(function (doc) {
                idMap.push(doc._id);
                docs.push(doc);
            });
        }

        var callback = _.last(_.toArray(arguments)),
            async = _.isFunction(callback);

        if (async && !options.withoutMongo) {
            return RPS._write(collection, method, options, function (err, res) {
                if (!err) {
                    afterWrite(res);
                }
                callback(err, res);
            });
        } else {
            var res = !options.withoutMongo && RPS._write(collection, method, options);
            return afterWrite(res);
        }
    }
};