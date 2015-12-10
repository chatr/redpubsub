RPS.write = function (collection, method, options) {
    console.log('RPS.write; collection._name:', collection._name);

    var config = RPS.config[collection._name] || {},
        channels, idMap = [], docs, fields;

    var publish = function (res) {
        if (channels) {
            console.log('RPS.write → ready to notify Redis; res:', res);

            var id = options.selector._id || idMap;

            if (!id || !id.length) {
                id = method === 'insert'? res : method === 'upsert' && res.insertedId;
            }

            console.log('RPS.write; channels:', channels);

            var message = JSON.stringify({
                _serverId: RPS._serverId,
                selector: options.selector,
                modifier: options.modifier,
                id: id
            });

            _.each(_.isArray(channels) ? channels : [channels], function (channel) {
                console.log('RPS.write → publish to Redis; channel, message:', channel, message);
                if (channel && message) {
                    RPS._pub(channel, message);
                }
            });
        }

        return res;
    };

    options.selector = options.selector || options.doc;
    options.fields = options.fields || {};

    channels = options.channels || config.channels;
    var channelsIsFunction = _.isFunction(channels);
    var fetchFields = options.fetchFields || config.fetchFields;
    if (channels && method !== 'insert') {
        var existedFields = _.union(_.keys(options.selector), _.keys(options.fields)),
            missedFields = _.difference(fetchFields, existedFields);

        console.log('RPS.write; _.keys(options.fields), existedFields, missedFields:', _.keys(options.fields), existedFields, missedFields);

        if ((missedFields.length && channelsIsFunction) || !options.selector._id) {
            var findOptions = {fields: {}};
            _.each(missedFields.length ? missedFields : ['_id'], function(fieldName) {
                findOptions.fields[fieldName] = 1;
            });

            console.log('RPS.write → FETCH DOCS FROM DB; options.selector, fields:', options.selector, findOptions);
            docs = collection.find(options.selector, findOptions).fetch();
            idMap = _.pluck(docs, '_id');
            if (idMap.length === 1) {
                idMap = idMap[0];
            }
        }
    }

    _.each(fetchFields, function (field) {
        if (!fields) fields = {};

        var value = options.fields[field] || options.selector[field] || _.compact(_.uniq(_.pluck(docs, field)));

        if (_.isArray(value) && value.length === 1) {
            value = value[0];
        }

        fields[field] = value;
    });

    if (channelsIsFunction) {
        channels = channels(options.selector, fields);
    }

    var callback = _.last(_.toArray(arguments)),
        async = _.isFunction(callback);

    if (async) {
        return RPS._write(collection, method, options, function (err, res) {
            if (!err) {
                publish(res);
            }
            (callback)(err, res);
        });
    } else {
        return publish(RPS._write(collection, method, options));
    }
};