RPS.publish = function (sub, requests) {
    requests = _.isArray(requests) ? requests : [requests];
    const handlers = [];

    _.each(requests, function (request, i) {
        const collectionName = request.collectionName || request.collection._name;

        const handler = RPS.observeChanges(request.collection, request.options, {
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
        sub = null;
    });

    var docs = _.pluck(handlers, 'docs');

    return docs.length > 1 ? docs : docs[0];
};
