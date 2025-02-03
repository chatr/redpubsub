import { observeChanges } from './observe-changes';

/**
 * Publishes data to the client using RPS.
 * It sets up observation on the given collection and sends added/changed/removed events.
 * @param {Object} sub The Meteor subscription object.
 * @param {Array|Object} requests A single request or an array of requests describing the publication.
 * @return {Object|Array<Object>} A handler or array of handlers to stop the observers.
 */
async function publish(sub, requests) {
    // Ensure requests is an array.
    requests = Array.isArray(requests) ? requests : [requests];

    // Map each request to an observeChanges call.
    const handlersPromises = requests.map((request) => {
        // Determine the collection name (either provided or from collection._name).
        const collectionName = request.collectionName || request.collection._name;
        return observeChanges(
            request.collection,
            { ...request.options },
            {
                // When a document is added, forward it via sub.added.
                added: (id, fields) => {
                    sub.added(collectionName, id, fields);
                },
                // When a document is changed, forward it via sub.changed.
                changed: (id, fields) => {
                    sub.changed(collectionName, id, fields);
                },
                // When a document is removed, forward it via sub.removed.
                removed: (id) => {
                    sub.removed(collectionName, id);
                },
            },
        );
    });

    // Wait for all observeChanges handlers to be set up.
    const handlers = await Promise.all(handlersPromises);

    // Signal that the subscription is ready.
    sub.ready();
    // When the subscription stops, remove all observers.
    sub.onStop(() => {
        handlers.forEach((handler) => {
            handler.stop();
        });
    });

    // Return a single handler if only one request was passed.
    return handlers.length > 1 ? handlers : handlers[0];
}

export { publish };
