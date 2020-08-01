RPS.publish = function (sub, requests) {
    requests = _.isArray(requests) ? requests : [requests];
    const handlers = [];

    _.each(requests, function (request, i) {
        const collectionName = request.collectionName || request.collection._name;

        const handler = RPS.observeChanges(request.collection, EJSON.clone(request.options), {
            added: function (id, fields) {
                sub && sub.added(collectionName, id, fields);
            },
            changed: function (id, fields) {
                sub && sub.changed(collectionName, id, fields);
            },
            removed: function (id) {
                sub && sub.removed(collectionName, id);
            }
        });

        handlers.push(handler);
    });

    sub.ready();

    sub.onStop(function () {
        while (handlers.length) {
            handlers.shift().stop();
        }
    });

    return handlers.length > 1 ? handlers : handlers[0];
};
