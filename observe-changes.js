import { LRUCache } from 'lru-cache'
import { Random } from 'meteor/random';
import { EJSON } from 'meteor/ejson';
import { Minimongo } from 'meteor/minimongo';
import { DiffSequence } from 'meteor/diff-sequence';
import { messenger } from './messenger';

// Global cache for compiled projection functions.
// Key: JSON string of projection fields, Value: compiled projection function.
const projectionCache = new LRUCache({
    max: 50000, // Limit the number of cached projections.
    ttl: 1000 * 60 * 60 * 8, // Cache for 8 hours.
});

// Global cache for matchers.
// Key: JSON string of the selector, Value: Minimongo.Matcher instance.
const matcherCache = new LRUCache({
    max: 50000, // Limit the number of cached matchers.
    ttl: 1000 * 60 * 60 * 8, // Cache for 8 hours.
});

// Global map for observers indexed by a unique observer key.
const observers = {};

/**
 * Utility function to extract the top-level field name from a dot-notated path.
 * @param {string} path The full dot-notated path.
 * @return {string} The top-level field.
 */
function topLevelPath(path) {
    const index = path.indexOf('.');
    return index !== -1 ? path.substring(0, index) : path;
}

/**
 * Helper function to omit specified keys from an object.
 * @param {Object} obj - The object to filter.
 * @param {string[]} keys - An array of keys to omit.
 * @return {Object} A new object without the omitted keys.
 */
function omit(obj, keys) {
    const result = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && !keys.includes(key)) {
            result[key] = obj[key];
        }
    }
    return result;
}

/**
 * Observer class monitors changes on a MongoDB collection.
 * It handles initial fetch, diff computation, and calls registered listeners
 * when documents are added, changed, or removed.
 */
class Observer {
    /**
     * Constructs an Observer instance.
     * @param {Mongo.Collection} collection The collection to observe.
     * @param {Object} options Options including selector, fields, etc.
     * @param {string} key A unique key for the observer.
     */
    constructor(collection, options, key) {
        this.collection = collection;
        this.options = options;
        // MongoDB selector for documents to observe.
        this.selector = options.selector || {};
        // Options for the Mongo find query.
        this.findOptions = options.options || {};
        this.findOptions.fields = this.findOptions.fields || {};
        // If limit is set and lazyLimit option is not true, we always re-fetch.
        this.needToFetchAlways = this.findOptions.limit && !options.lazyLimit;
        // Quick find options used for lightweight queries (only _id field).
        this.quickFindOptions = { ...this.findOptions, fields: { _id: 1 } };

        // Setup projection: which fields to include/exclude.
        this.projectionFields = { ...this.findOptions.fields };
        this.projectionIncluding = null;
        this._initializeProjection();

        // Channel name for receiving updates (default to collection name).
        this.channel = options.channel || collection._name;
        this.key = key;
        // Map of listeners for different subscriptions (listenerId => callbacks).
        this.listeners = {};
        // Set of actions (added/changed/removed) requested by listeners.
        this.actions = {};
        // Cached documents keyed by their _id.
        this.docs = {};
        // To handle out-of-order messages, store last method and timestamp per document.
        this.lastMethod = {};
        this.lastTs = {};
        // Queue of messages received while processing is paused.
        this.messageQueue = [];
        this.paused = false;
        this.initiallyFetched = false;
        this.initialized = false;

        // Validate that _id is not excluded from fields.
        if (this.findOptions.fields._id === 0 || this.findOptions.fields._id === false) {
            throw new Error('You may not observe a cursor with {fields: {_id: 0}}');
        }

        this.initialize();
    }

    /**
     * Initializes projection settings.
     * @private
     */
    _initializeProjection() {
        if (this.projectionFields) {
            // Build a map of top-level fields from the projection.
            this.projectionTopFields = {};
            Object.entries(this.projectionFields).forEach(([path, rule]) => {
                if (path === '_id') {
                    return;
                }
                // Convert rule to boolean (include/exclude).
                rule = !!rule;
                if (this.projectionIncluding === null) {
                    this.projectionIncluding = rule;
                }
                if (this.projectionIncluding !== rule) {
                    throw new Error('You cannot currently mix including and excluding fields.');
                }
                // Save only the top-level field.
                this.projectionTopFields[topLevelPath(path)] = rule;
            });

            // If docsMixin is provided, merge or remove mixin fields accordingly.
            if (this.options.docsMixin) {
                Object.keys(this.options.docsMixin).forEach((key) => {
                    if (this.projectionIncluding) {
                        this.projectionFields[key] = 1;
                    } else {
                        delete this.projectionFields[key];
                    }
                });
            }

            // Create a key from the projectionFields object to check the cache.
            const projectionKey = JSON.stringify(this.projectionFields);
            if (projectionCache.has(projectionKey)) {
                // Use cached compiled projection function.
                this.projectionFn = projectionCache.get(projectionKey);
            } else {
                // Compile a new projection function and cache it.
                const compiled = Minimongo.LocalCollection._compileProjection(this.projectionFields);
                projectionCache.set(projectionKey, compiled);
                this.projectionFn = compiled;
            }
        } else {
            // If no projectionFields are provided, use identity function.
            this.projectionFn = (doc) => doc;
        }

        // Create a key from the selector object to check the cache.
        const selectorKey = JSON.stringify(this.selector);
        if (matcherCache.has(selectorKey)) {
            // Use cached matcher.
            this.matcher = matcherCache.get(selectorKey);
        } else {
            try {
                // Create a new matcher and cache it.
                this.matcher = new Minimongo.Matcher(this.selector);
                matcherCache.set(selectorKey, this.matcher);
            } catch (err) {
                console.error('[Observer._initializeProjection] Error compiling matcher:', err);
            }
        }

        try {
            // Combine projection with matcher if possible.
            this.findOptions.fields = this.projectionFields
                && this.matcher.combineIntoProjection(this.projectionFields);
        } catch (err) {
            console.error('[Observer._initializeProjection] Error combining matcher/projection:', err);
        }
    }

    /**
     * Initializes the observer by registering it with the messenger.
     * This allows the observer to receive messages via its channel.
     */
    initialize() {
        if (this.initialized) {
            return;
        }
        // Register the observer unless it is marked as nonreactive.
        if (!this.options.nonreactive) {
            messenger.addObserver(this.key, this.channel);
        }
        this.initialized = true;
    }

    /**
     * Adds a new listener (subscription) to this observer.
     * The listener receives callbacks for added/changed/removed events.
     * @param {string} listenerId Unique identifier for the listener.
     * @param {Object} callbacks An object with added, changed, removed callback functions.
     */
    async addListener(listenerId, callbacks) {
        this.listeners[listenerId] = callbacks || {};
        // Update the list of actions (what events to watch) based on listener callbacks.
        this._refreshActionsList(listenerId);
        // Pause message processing while performing the initial fetch.
        this.pause();
        // Fetch the initial set of documents.
        await this.initialFetch();
        // Send initial added events to the new listener.
        this.initialAdd(listenerId);
        // Resume processing of queued messages.
        this.resume();
    }

    /**
     * Refreshes the list of actions (e.g., added, changed, removed) that should be observed.
     * @param {string=} listenerId Optional listenerId to refresh only one listener's actions.
     * @private
     */
    _refreshActionsList(listenerId) {
        if (listenerId) {
            // Update actions for the given listener.
            Object.keys(this.listeners[listenerId]).forEach((action) => {
                this.actions[action] = 1;
            });
        } else {
            // Update actions for all listeners.
            const actions = {};
            Object.values(this.listeners).forEach((callbacks) => {
                Object.keys(callbacks).forEach((action) => {
                    actions[action] = 1;
                });
            });
            this.actions = actions;
        }
    }

    /**
     * Performs the initial fetch of documents from the collection.
     * Stores the documents in the observer's cache.
     */
    async initialFetch() {
        if (this.initiallyFetched) {
            return;
        }

        if (!this.options.withoutMongo) {
            // Execute the Mongo query asynchronously.
            const cursor = this.collection.find(this.selector, this.findOptions);
            const docs = await cursor.fetchAsync();
            // Store each document in the observer cache, applying docsMixin if provided.
            for (const doc of docs) {
                this.docs[doc._id] = this.options.docsMixin ? { ...doc, ...this.options.docsMixin } : doc;
            }
        }

        this.initiallyFetched = true;
    }

    /**
     * Sends initial "added" events to a newly added listener.
     * @param {string} listenerId The listener identifier.
     */
    initialAdd(listenerId) {
        const callbacks = this.listeners[listenerId];
        // For each cached document, call the "added" callback.
        Object.entries(this.docs).forEach(([id, doc]) => {
            if (doc && callbacks.added) {
                callbacks.added(id, this.projectionFn(doc));
            }
        });
    }

    /**
     * Calls all listeners for a particular action (added/changed/removed) for a document.
     * @param {string} action The type of action.
     * @param {string} id The document _id.
     * @param {Object=} fields The fields to send to the client.
     */
    callListeners(action, id, fields) {
        Object.values(this.listeners).forEach((callbacks) => {
            if (callbacks && callbacks[action]) {
                callbacks[action](id, fields);
            }
        });
    }

    /**
     * Removes a listener from the observer.
     * If no listeners remain, the observer stops observing.
     * @param {string} listenerId The listener identifier.
     */
    removeListener(listenerId) {
        delete this.listeners[listenerId];
        if (Object.keys(this.listeners).length === 0) {
            // Stop the observer if no listeners remain.
            this.kill();
            this.actions = {};
        } else {
            // Refresh the list of actions.
            this._refreshActionsList();
        }
    }

    /**
     * Pauses the processing of incoming messages.
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resumes processing of messages.
     * Processes any messages that were queued while paused.
     */
    resume() {
        // Process messages in the queue.
        while (this.messageQueue.length) {
            // Note: In this implementation, handleMessage is asynchronous,
            // but we do not await here because order is not critical.
            this.handleMessage(this.messageQueue.shift());
        }
        this.paused = false;
    }

    /**
     * Stops the observer and unregisters it from the messenger.
     */
    kill() {
        if (!this.initialized) return;
        this.initialized = false;
        if (!this.options.nonreactive) {
            messenger.removeObserver(this.key);
        }
        delete observers[this.key];
    }

    /**
     * Handles an incoming message from the messenger.
     * If the observer is not ready, the message may be queued.
     * @param {Object} message The incoming message.
     */
    onMessage(message) {
        if (!this.initiallyFetched) {
            return;
        }
        // Filter messages based on withoutMongo and withMongoOnly flags.
        if (message.withoutMongo && this.options.withMongoOnly) {
            return;
        }
        if (this.paused) {
            // Queue message if processing is paused.
            this.messageQueue.push(message);
        } else {
            this.handleMessage(message);
        }
    }

    /**
     * Processes an incoming message.
     * Applies changes to the cached documents and calls listeners accordingly.
     * @param {Object} message The message to process.
     */
    async handleMessage(message) {
        // Helper to compute modified fields from a Mongo modifier.
        const computeModifiedFields = () => {
            if (!message.modifier || message._modifiedFields) {
                return;
            }
            message._modifiedFields = {};

            // Iterate over each entry in the modifier object.
            // For example, message.modifier might look like:
            // { $set: { "user.name": "Alice", "user.email": "alice@example.com" }, $inc: { "score": 1 } }
            Object.entries(message.modifier).forEach(([op, params]) => {
                if (op.charAt(0) === '$') {
                    // For each field path in the parameters object of the operator, extract the top-level field.
                    // For example, for the path "user.name", topLevelPath will return "user".
                    Object.keys(params).forEach((path) => {
                        // Mark the top-level field as modified.
                        message._modifiedFields[topLevelPath(path)] = true;
                    });
                }
            });
        };

        // Matching logic: check if document matches selector.
        if (this.matcher && message.doc) {
            if (!this.matcher.documentMatches(message.doc).result) {
                if (this.docs[message.id]) {
                    // Document no longer matches; notify removal.
                    this.callListeners('removed', message.id);
                    this.docs[message.id] = null;
                    if (!this.needToFetchAlways) {
                        return;
                    }
                } else {
                    return;
                }
            } else if (this.docs[message.id] && !this.needToFetchAlways) {
                if (!this.actions.changed) {
                    return;
                }
                if (this.projectionIncluding && message.modifier) {
                    computeModifiedFields();
                    // Check if any relevant top-level field was modified.
                    const relevantModifier = Object.keys(message._modifiedFields).some(
                        (field) => this.projectionTopFields[field],
                    );
                    if (!relevantModifier) {
                        return;
                    }
                }
            }
        }

        let fetchedRightIds;
        let ids = Array.isArray(message.id) ? message.id : [message.id];

        if (this.needToFetchAlways) {
            const cursor = this.collection.find(this.selector, this.quickFindOptions);
            const docs = await cursor.fetchAsync();
            fetchedRightIds = docs.map((doc) => doc._id);
        }

        if (message.withoutMongo && !ids) {
            try {
                const selectorKey = JSON.stringify(message.selector);
                let matcherForMessage;
                if (matcherCache.has(selectorKey)) {
                    matcherForMessage = matcherCache.get(selectorKey);
                } else {
                    matcherForMessage = new Minimongo.Matcher(message.selector);
                    matcherCache.set(selectorKey, matcherForMessage);
                }
                ids = Object.values(this.docs)
                    .filter((doc) => doc && matcherForMessage.documentMatches(doc).result)
                    .map((doc) => doc._id);
            } catch (err) {
                console.error('[Observer.handleMessage] Error compiling matcher:', err);
            }
        }

        if (!ids || ids.length === 0) {
            return;
        }

        // Process each document id from the message.
        for (const id of ids) {
            const lastTs = this.lastTs[id];
            const badTS = lastTs >= message.ts;
            const lastMethod = this.lastMethod[id];

            // Update timestamp if message is newer.
            this.lastTs[id] = badTS ? lastTs : message.ts;

            // Skip message if out-of-order and not applicable.
            if (
                badTS
                && lastMethod
                && (
                    (message.method !== 'remove' && lastMethod === 'remove')
                    || (message.method === 'remove' && (lastMethod === 'insert' || lastMethod === 'upsert'))
                )
            ) {
                continue;
            }

            this.lastMethod[id] = message.method;

            const oldDoc = this.docs[id];
            const knownId = !!oldDoc;
            const isRightId = !fetchedRightIds || fetchedRightIds.includes(id);

            let newDoc = message.doc;

            if (!newDoc) {
                if (message.method === 'insert' && !badTS) {
                    newDoc = { ...message.selector, _id: id };
                } else if (message.withoutMongo && message.method !== 'remove') {
                    try {
                        if (oldDoc) {
                            // Retrieve a cached matcher for message.selector.
                            const selectorKey = JSON.stringify(message.selector);
                            let matcherForMessage;
                            if (matcherCache.has(selectorKey)) {
                                matcherForMessage = matcherCache.get(selectorKey);
                            } else {
                                matcherForMessage = new Minimongo.Matcher(message.selector);
                                matcherCache.set(selectorKey, matcherForMessage);
                            }
                            // If oldDoc does not match the selector, skip processing.
                            if (!matcherForMessage.documentMatches(oldDoc).result) {
                                continue;
                            }
                        }
                        newDoc = { _id: id, ...oldDoc };
                        Minimongo.LocalCollection._modify(newDoc, message.modifier);
                    } catch (err) {
                        console.error('[Observer.handleMessage] Error modifying document:', err);
                    }
                }
            }

            if (
                !newDoc
                && oldDoc
                && (message.method === 'update' || message.method === 'upsert')
                && isRightId
                && !badTS
            ) {
                try {
                    newDoc = EJSON.clone(oldDoc);
                    Minimongo.LocalCollection._modify(newDoc, message.modifier);
                } catch (err) {
                    console.error('[Observer.handleMessage] Error modifying document:', err);
                }
            }

            const needToFetch = !newDoc && isRightId && message.method !== 'remove';
            if (needToFetch) {
                newDoc = await this.collection.findOneAsync({ ...this.selector, _id: id }, this.findOptions);
            }

            // Validate that the new document is acceptable.
            const docIsOk = newDoc && isRightId && (
                message.withoutMongo
                || needToFetch
                || (
                    this.matcher
                        ? (message.doc || this.matcher.documentMatches(newDoc).result)
                        : await this.collection.find({ ...this.selector, _id: id }, this.quickFindOptions).countAsync()
                )
            );

            if (message.method !== 'remove' && docIsOk) {
                if (this.options.docsMixin) {
                    // Compute modified fields and merge docsMixin into newDoc,
                    // omitting any keys that have been modified.
                    computeModifiedFields();
                    Object.assign(
                        newDoc,
                        omit(this.options.docsMixin, Object.keys(message._modifiedFields || {})),
                    );
                }

                let action;
                let fields;
                if (knownId) {
                    action = 'changed';
                    fields = DiffSequence.makeChangedFields(newDoc, oldDoc);
                } else {
                    action = 'added';
                    fields = newDoc;
                }

                const finalFields = this.projectionFn(fields);
                if (Object.keys(finalFields).length > 0) {
                    this.callListeners(action, id, finalFields);
                }
                this.docs[id] = newDoc;
            } else if (knownId) {
                this.callListeners('removed', id);
                this.docs[id] = null;
            }

            if (fetchedRightIds) {
                // Remove documents that are no longer valid.
                for (const [docId, doc] of Object.entries(this.docs)) {
                    if (doc && !fetchedRightIds.includes(docId)) {
                        this.callListeners('removed', docId);
                        this.docs[docId] = null;
                    }
                }
                // Add documents that are newly fetched.
                for (const fetchId of fetchedRightIds) {
                    if (!this.docs[fetchId]) {
                        const doc = await this.collection.findOneAsync({ _id: fetchId }, this.findOptions);
                        if (this.options.docsMixin) {
                            Object.assign(
                                doc,
                                omit(this.options.docsMixin, Object.keys(message._modifiedFields || {})),
                            );
                        }
                        this.callListeners('added', fetchId, this.projectionFn(doc));
                        this.docs[fetchId] = doc;
                    }
                }
            }
        }
    }
}

// Set the global messenger callback to route incoming messages
// to all observers registered on the channel.
messenger.onMessage = (channel, message) => {
    const observersInChannel = messenger.channels[channel];
    if (observersInChannel) {
        Object.keys(observersInChannel).forEach((observerKey) => {
            const observer = observers[observerKey];
            if (observer) {
                observer.onMessage(message);
            }
        });
    }
};

/**
 * Sets up an observation on a MongoDB collection.
 * @param {Mongo.Collection} collection The collection to observe.
 * @param {Object=} options Observation options (selector, fields, etc).
 * @param {Object} callbacks Callback functions for added, changed, removed events.
 * @return {Object} An object with a stop() method to end the observation and the current docs cache.
 */
async function observeChanges(collection, options = {}, callbacks = {}) {
    // Generate a unique listener id.
    const listenerId = Random.id();
    const collectionName = collection._name;
    // Create a unique key for the observer based on collection and options.
    const observerKey = options.observerKey || JSON.stringify([collectionName, options]);

    let observer = observers[observerKey];
    if (!observer) {
        // If no observer exists for this key, create one.
        observer = new Observer(collection, options, observerKey);
        observers[observerKey] = observer;
    }

    // Add the listener to the observer.
    await observer.addListener(listenerId, callbacks);

    return {
        stop() {
            observer.removeListener(listenerId);
        },
        docs: observer.docs, // Expose the cached documents.
    };
}

export { observeChanges };
