RPS.publish = function (sub, requests) {
    requests = _.isArray(requests) ? requests : [requests];
    var handlers = [];

    _.each(requests, function (request, i) {
        var collectionName = request.collectionName || request.collection._name;

        var handler = RPS.observeChanges(request.collection, request.options, {
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
        handlers = null;
        sub = null;
    });

    var docs = _.pluck(handlers, 'docs');

    return docs.length > 1 ? docs : docs[0];
};
