import { Random } from 'meteor/random';
import { EJSON } from 'meteor/ejson';
import { Minimongo } from 'meteor/minimongo';
import { DiffSequence } from 'meteor/diff-sequence';
import { messenger } from './messenger';

const observers = {};

/**
 * Extracts the top-level path from a dot-notated path.
 * @param {string} path The full path.
 * @return {string} The top-level path.
 */
function topLevelPath(path) {
    const index = path.indexOf('.');
    return index !== -1 ? path.substring(0, index) : path;
}

class Observer {
    /**
     * Creates an Observer instance.
     * @param {Mongo.Collection} collection The collection to observe.
     * @param {Object} options Observation options.
     * @param {string} key The observer key.
     */
    constructor(collection, options, key) {
        this.collection = collection;
        this.options = options;
        this.selector = options.selector || {};
        this.findOptions = options.options || {};
        this.findOptions.fields = this.findOptions.fields || {};
        this.needToFetchAlways = this.findOptions.limit && !options.lazyLimit;
        this.quickFindOptions = { ...this.findOptions, fields: { _id: 1 } };

        this.projectionFields = { ...this.findOptions.fields };
        this.projectionIncluding = null;
        this._initializeProjection();

        this.channel = options.channel || collection._name;
        this.key = key;
        this.listeners = {};
        this.actions = {};
        this.docs = {};
        this.lastMethod = {};
        this.lastTs = {};
        this.messageQueue = [];
        this.paused = false;
        this.initiallyFetched = false;
        this.initialized = false;

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
            this.projectionTopFields = {};
            Object.entries(this.projectionFields).forEach(([path, rule]) => {
                if (path === '_id') {
                    return;
                }

                rule = !!rule;

                if (this.projectionIncluding === null) {
                    this.projectionIncluding = rule;
                }

                if (this.projectionIncluding !== rule) {
                    throw new Error('You cannot currently mix including and excluding fields.');
                }

                this.projectionTopFields[topLevelPath(path)] = rule;
            });

            if (this.options.docsMixin) {
                Object.keys(this.options.docsMixin).forEach((key) => {
                    if (this.projectionIncluding) {
                        this.projectionFields[key] = 1;
                    } else {
                        delete this.projectionFields[key];
                    }
                });
            }
        }

        this.projectionFn = this.projectionFields
            ? Minimongo.LocalCollection._compileProjection(this.projectionFields)
            : (doc) => doc;

        try {
            this.matcher = new Minimongo.Matcher(this.selector);
            this.findOptions.fields = this.projectionFields
                && this.matcher.combineIntoProjection(this.projectionFields);
        } catch (e) {
            // Ignore error
        }
    }

    /**
     * Initializes the observer.
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        if (!this.options.nonreactive) {
            messenger.addObserver(this.key, this.channel);
        }

        this.initialized = true;
    }

    /**
     * Adds a listener to the observer.
     * @param {string} listenerId The listener ID.
     * @param {Object} callbacks The callbacks for added/changed/removed.
     */
    async addListener(listenerId, callbacks) {
        this.listeners[listenerId] = callbacks || {};
        this._refreshActionsList(listenerId);
        this.pause();
        await this.initialFetch();
        this.initialAdd(listenerId);
        this.resume();
    }

    /**
     * Refreshes the list of actions based on listeners.
     * @param {string=} listenerId The listener ID.
     * @private
     */
    _refreshActionsList(listenerId) {
        if (listenerId) {
            Object.keys(this.listeners[listenerId]).forEach((action) => {
                this.actions[action] = 1;
            });
        } else {
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
     * Performs the initial fetch of documents.
     */
    async initialFetch() {
        if (this.initiallyFetched) {
            return;
        }

        if (!this.options.withoutMongo) {
            const cursor = this.collection.find(this.selector, this.findOptions);
            const docs = await cursor.fetchAsync();

            for (const doc of docs) {
                this.docs[doc._id] = this.options.docsMixin ? { ...doc, ...this.options.docsMixin } : doc;
            }
        }

        this.initiallyFetched = true;
    }

    /**
     * Adds initial documents to listeners.
     * @param {string} listenerId The listener ID.
     */
    initialAdd(listenerId) {
        const callbacks = this.listeners[listenerId];

        Object.entries(this.docs).forEach(([id, doc]) => {
            if (doc && callbacks.added) {
                callbacks.added(id, this.projectionFn(doc));
            }
        });
    }

    /**
     * Calls the appropriate listeners for an action.
     * @param {string} action The action type.
     * @param {string} id The document ID.
     * @param {Object=} fields The fields involved.
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
     * @param {string} listenerId The listener ID.
     */
    removeListener(listenerId) {
        delete this.listeners[listenerId];
        if (Object.keys(this.listeners).length === 0) {
            this.kill();
            this.actions = {};
        } else {
            this._refreshActionsList();
        }
    }

    /**
     * Pauses message processing.
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resumes message processing.
     */
    resume() {
        while (this.messageQueue.length) {
            this.handleMessage(this.messageQueue.shift());
        }
        this.paused = false;
    }

    /**
     * Kills the observer.
     */
    kill() {
        if (!this.initialized) {
            return;
        }
        this.initialized = false;

        if (!this.options.nonreactive) {
            messenger.removeObserver(this.key);
        }

        delete observers[this.key];
    }

    /**
     * Processes a message from the messenger.
     * @param {Object} message The message to process.
     */
    onMessage(message) {
        if (!this.initiallyFetched) {
            return;
        }

        if (message.withoutMongo && this.options.withMongoOnly) {
            return;
        }

        if (this.paused) {
            this.messageQueue.push(message);
        } else {
            this.handleMessage(message);
        }
    }

    /**
     * Handles an incoming message.
     * @param {Object} message The message to handle.
     */
    async handleMessage(message) {
        const computeModifiedFields = () => {
            if (!message.modifier || message._modifiedFields) {
                return;
            }

            message._modifiedFields = {};

            Object.entries(message.modifier).forEach(([op, params]) => {
                if (op.charAt(0) === '$') {
                    Object.keys(params).forEach((path) => {
                        message._modifiedFields[topLevelPath(path)] = true;
                    });
                }
            });
        };

        if (this.matcher && message.doc) {
            if (!this.matcher.documentMatches(message.doc).result) {
                if (this.docs[message.id]) {
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
                } if (this.projectionIncluding && message.modifier) {
                    computeModifiedFields();

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
                const matcher = new Minimongo.Matcher(message.selector);
                ids = Object.values(this.docs)
                    .filter((doc) => doc && matcher.documentMatches(doc).result)
                    .map((doc) => doc._id);
            } catch (e) {
                // Ignore error
            }
        }

        if (!ids || ids.length === 0) {
            return;
        }

        for (const id of ids) {
            const lastTs = this.lastTs[id];
            const badTS = lastTs >= message.ts;
            const lastMethod = this.lastMethod[id];

            this.lastTs[id] = badTS ? lastTs : message.ts;

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
                            const matcher = new Minimongo.Matcher(message.selector);
                            if (!matcher.documentMatches(oldDoc).result) continue;
                        }

                        newDoc = { _id: id, ...oldDoc };
                        Minimongo.LocalCollection._modify(newDoc, message.modifier);
                    } catch (e) {
                        // Ignore error
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
                } catch (e) {
                    // Ignore error
                }
            }

            const needToFetch = !newDoc && isRightId && message.method !== 'remove';

            if (needToFetch) {
                newDoc = await this.collection.findOneAsync({ ...this.selector, _id: id }, this.findOptions);
            }

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
                    computeModifiedFields();
                    Object.assign(newDoc, this.options.docsMixin);
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
                for (const [docId, doc] of Object.entries(this.docs)) {
                    if (doc && !fetchedRightIds.includes(docId)) {
                        this.callListeners('removed', docId);
                        this.docs[docId] = null;
                    }
                }

                for (const fetchId of fetchedRightIds) {
                    if (!this.docs[fetchId]) {
                        const doc = await this.collection.findOneAsync({ _id: fetchId }, this.findOptions);
                        if (this.options.docsMixin) {
                            Object.assign(doc, this.options.docsMixin);
                        }
                        this.callListeners('added', fetchId, this.projectionFn(doc));
                        this.docs[fetchId] = doc;
                    }
                }
            }
        }
    }
}

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
 * Observes changes on a MongoDB collection.
 * @param {Mongo.Collection} collection The collection to observe.
 * @param {Object=} options The options for observation.
 * @param {Object} callbacks The callbacks for added/changed/removed.
 * @return {{stop: function(), docs: Object}} An object with stop() method and docs.
 */
async function observeChanges(collection, options = {}, callbacks = {}) {
    const listenerId = Random.id();
    const collectionName = collection._name;
    const observerKey = options.observerKey || JSON.stringify([collectionName, options]);

    let observer = observers[observerKey];
    if (!observer) {
        observer = new Observer(collection, options, observerKey);
        observers[observerKey] = observer;
    }

    await observer.addListener(listenerId, callbacks);

    return {
        stop() {
            observer.removeListener(listenerId);
        },
        docs: observer.docs,
    };
}

export { observeChanges };
