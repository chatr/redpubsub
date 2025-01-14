import { observeChanges } from './observe-changes';

/**
 * Publishes data to the client using RPS.
 * @param {Object} sub The subscription object.
 * @param {Array|Object} requests The requests to observe.
 * @return {Object|Array<Object>} The handler(s) for the observer(s).
 */
async function publish(sub, requests) {
    requests = Array.isArray(requests) ? requests : [requests];

    const handlersPromises = requests.map((request) => {
        const collectionName = request.collectionName || request.collection._name;
        return observeChanges(
            request.collection,
            { ...request.options },
            {
                added: (id, fields) => {
                    sub.added(collectionName, id, fields);
                },
                changed: (id, fields) => {
                    sub.changed(collectionName, id, fields);
                },
                removed: (id) => {
                    sub.removed(collectionName, id);
                },
            },
        );
    });
    const handlers = await Promise.all(handlersPromises);

    sub.ready();
    sub.onStop(() => {
        handlers.forEach((handler) => {
            handler.stop();
        });
    });

    return handlers.length > 1 ? handlers : handlers[0];
}

export { publish };
