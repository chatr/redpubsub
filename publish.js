RPS.publish = function (sub, requests) {
    //console.log('RPS.publish; sub, requests:', sub, requests);

    requests = _.isArray(requests) ? requests : [requests];
    var length = requests.length,
        handlers = [];

    _.each(requests, function (request, i) {
        var collectionName = request.collection._name;

        console.log('RPS.publish → observeChanges; collectionName:', collectionName);

        var handler = RPS.observeChanges(request.collection, request.options, {
            added: function (id, fields) {
                console.log('RPS.publish.added; request.options._name, collectionName, id, fields:', request.options._name, collectionName, id, fields);
                sub.added(collectionName, id, fields);
            },
            changed: function (id, fields) {
                console.log('RPS.publish.changed; request.options._name, collectionName, id, fields:', request.options._name, collectionName, id, fields);
                sub.changed(collectionName, id, fields);
            },
            removed: function (id) {
                console.log('RPS.publish.removed; request.options._name, collectionName, id:', request.options._name, collectionName, id);
                sub.removed(collectionName, id);
            }
        });

        handlers.push(handler);

        if (i >= length - 1) {
            console.log('RPS.publish → ready; i:', i);
            sub.ready();
        }
    });

    sub.onStop(function () {
        _.each(handlers, function (handler) {
            handler.stop();
        });
    });
};
