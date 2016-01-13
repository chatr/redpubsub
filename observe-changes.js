RPS._observers = {};

RPS.observeChanges = function (collection, options, callbacks) {
    //console.log('RPS.observeChanges');

    options = options || {};

    var listenerId = Random.id(),
        collectionName = collection._name,
        cursorDescription = {
            collectionName: collectionName,
            options: _.extend(options, {selector: Mongo.Collection._rewriteSelector(options.selector || {})})
        },
        observerKey = JSON.stringify(cursorDescription),
        observer = RPS._observers[observerKey] || (RPS._observers[observerKey] = new RPS._observer(collection, options, observerKey));

    // initial fetch, if needed or take it from cache (pause incoming messages, while initial add)
    observer.addListener(listenerId, callbacks);

    // return stop method
    return {
        stop: function () {
            observer.removeListener(listenerId);
        },
        docs: observer.docs
    }
};

RPS._observer = function (collection, options, key) {
    //console.log('RPS._observer');

    this.collection = collection;
    this.options = options;
    this.selector = options.selector;
    this.findOptions = EJSON.clone(options.options) || {};
    this.findOptions.fields = this.findOptions.fields || {};
    this.needToFetchAlways = this.findOptions.limit || this.findOptions.sort;
    this.quickFindOptions = _.extend({}, this.findOptions, {fields: {_id: 1}});

    this.projectionFields = _.clone(this.findOptions.fields);
    _.each(this.options.docsMixin, function (value, key) {
        this.projectionFields[key] = 1;
    }, this);

    //console.log('RPS: this.projectionFields:', this.projectionFields);

    this.projectionFn = LocalCollection._compileProjection(this.projectionFields);

    try {
        this.matcher = new Minimongo.Matcher(this.selector);
        this.findOptions.fields = this.matcher.combineIntoProjection(this.projectionFields);
    } catch (e) {
        // ignore
    }

    this.channel = options.channel || collection._name;
    this.key = key;
    this.listeners = {};
    this.docs = {};
    this.lastMethods = {};
    this.messageQueue = [];

    // You may not filter out _id when observing changes, because the id is a core
    // part of the observeChanges API
    if (this.findOptions.fields._id === 0 ||
        this.findOptions.fields._id === false) {
        throw Error("You may not observe a cursor with {fields: {_id: 0}}");
    }

    this.initialize();
};

// initialize, subscribe to channel
RPS._observer.prototype.initialize = function () {
    if (this.initialized) return;
    //console.log('RPS._observer.initialize');

    RPS._messenger.addObserver(this.key, this.channel);

    this.initialized = true;
};

RPS._observer.prototype.addListener = function (listenerId, callbacks) {
    //console.log('RPS._observer.addListener; listenerId:', listenerId);
    this.listeners[listenerId] = callbacks || {};
    this.pause();
    this.initialFetch();
    this.initialAdd(listenerId);
    this.resume();
};

RPS._observer.prototype.callListeners = function (action, id, fields) {
    //console.log('RPS._observer.callListeners');
    _.each(this.listeners, function (callbacks, listenerId) {
        //console.log('RPS._observer.callListeners; listenerId, action, id, fields:', listenerId, action, id, fields);
        callbacks[action] && callbacks[action](id, fields);
    }, this);
};

RPS._observer.prototype.removeListener = function (listenerId) {
    //console.log('RPS._observer.removeListener; listenerId:', listenerId);
    delete this.listeners[listenerId];
    if (_.isEmpty(this.listeners)) {
        this.kill();
    }
};

RPS._observer.prototype.initialFetch = function () {
    if (this.initiallyFetched) return;
    //console.log('RPS._observer.initialFetch');

    if (!this.options.withoutMongo) {
        var docs = this.collection.find(this.selector, this.findOptions).fetch();

        _.each(docs, function (doc) {
            this.docs[doc._id] = doc;
        }, this);
    }

    this.initiallyFetched = true;
};

RPS._observer.prototype.initialAdd = function (listenerId) {
    //console.log('RPS._observer.initialAdd; listenerId:', listenerId);

    var callbacks = this.listeners[listenerId];

    if (callbacks.added) {
        _.each(this.docs, function (doc, id) {
            callbacks.added(id, _.extend(doc, this.options.docsMixin));
        }, this);
    }
};

RPS._observer.prototype.onMessage = function (message) {
    if (!this.initiallyFetched) return;
    //console.log('RPS._observer.onMessage; message:', message);

    if (this.paused) {
        this.messageQueue.push(message);
    } else {
        this.handleMessage(message);
    }
};

RPS._observer.prototype.handleMessage = function (message, noPause) {
    //noPause || this.pause();

    // fight against race condition
    var badTS = this.lastTS >= message.ts;
    this.lastTS = badTS ? this.lastTS : message.ts;

    //if (badTS) {
    //    console.warn('RPS: RACE CONDITION! Don’t worry will fix it');
    //}
    
    //If a message skips Mongo, it wont have any ID, yet the routien that follows relies on it. Forcing the issue for now.
    if (message.withoutMongo && !message.id) {
        message.id = message.ts + message._serverId;
    }

    //console.log('RPS._observer.handleMessage; message, this.selector:', message, this.selector);
    var rightIds = this.needToFetchAlways && _.pluck(this.collection.find(this.selector, this.quickFindOptions).fetch(), '_id'),
        ids = !message.id || _.isArray(message.id) ? message.id : [message.id];

    //console.log('RPS._observer.handleMessage; message.withoutMongo, ids:', message.withoutMongo, ids);
    if (message.withoutMongo && !ids) {
        //console.log('RPS._observer.handleMessage; this.docs, message.selector:', this.docs, message.selector);
        try {
            var matcher = new Minimongo.Matcher(message.selector);
            ids = _.pluck(_.filter(this.docs, function (doc) {
                return matcher.documentMatches(doc).result;
            }), '_id');
        } catch (e) {
            // ignore
        }
        //console.log('RPS._observer.handleMessage; ids:', ids);
    }

    if (!ids || !ids.length) return;

    _.each(ids, function (id) {
        var lastMethod = this.lastMethods[id];
        if (badTS
            && lastMethod
            && ((message.method !== 'remove' && lastMethod === 'remove') || (message.method === 'remove' && _.contains(['insert', 'upsert'], lastMethod)))) {
            //console.warn('RPS: SKIP MESSAGE! All fine already');
            return;
        }

        this.lastMethods[id] = message.method;

        var oldDoc = this.docs[id],
            knownId = !!oldDoc,
            isRightId = !rightIds || _.contains(rightIds, id),
            newDoc;

        //console.log('RPS._observer.handleMessage; oldDoc, this.selector:', oldDoc, this.selector);

        if (message.method === 'insert' && !badTS) {
            newDoc = _.extend(message.selector, {_id: id});
        } else if (message.withoutMongo && message.method !== 'remove') {
            try {
                newDoc = _.extend({_id: id}, oldDoc);
                LocalCollection._modify(newDoc, message.modifier);
            } catch (e) {}
        }

        if (!newDoc && oldDoc && _.contains(['update', 'upsert'], message.method) && isRightId && !badTS) {
            try {
                newDoc = EJSON.clone(oldDoc);
                LocalCollection._modify(newDoc, message.modifier);
            } catch (e) {}
        }

        var needToFetch = !newDoc && isRightId && message.method !== 'remove';

        //console.log('RPS._observer.handleMessage; this.collection._name, badTS, needToFetch:', this.collection._name, badTS, needToFetch);


        if (needToFetch) {
            newDoc = this.collection.findOne(_.extend({}, this.selector, {_id: id}), this.findOptions);
        }

        var dokIsOk = newDoc
            && isRightId
            && (message.withoutMongo
                || needToFetch
                || _.contains(rightIds, id)
                || (this.matcher ? this.matcher.documentMatches(newDoc).result : this.collection.find(_.extend({}, this.selector, {_id: id}), this.quickFindOptions).count()));

        //console.log('RPS._observer.handleMessage; newDoc, this.selector:', newDoc, this.selector);
        //console.log('RPS._observer.handleMessage; dokIsOk, this.selector:', dokIsOk, this.selector);
        //console.log('RPS._observer.handleMessage; _.isEqual(newDoc, oldDoc), this.selector:', _.isEqual(newDoc, oldDoc), this.selector);

        if (message.method !== 'remove' && dokIsOk) {
            if (this.options.docsMixin) {
                var fieldsFromModifier,
                    isSimpleModifier = RPS._isSimpleModifier(message.modifier);

                if (isSimpleModifier === 'NO_OPERATORS') {
                    fieldsFromModifier = _.keys(message.modifier);
                } else if (isSimpleModifier === 'ONLY_SETTERS') {
                    fieldsFromModifier = _.union(_.keys(message.modifier.$set || {}), _.keys(message.modifier.$unset || {}));
                }
                _.extend(newDoc, _.omit(this.options.docsMixin, fieldsFromModifier));
            }

            // added or changed
            var action, fields;

            if (knownId) {
                action = 'changed';
                fields = DiffSequence.makeChangedFields(newDoc, oldDoc);
            } else {
                action = 'added';
                fields = newDoc;
            }

            var finalFields = this.projectionFn(fields);
            //console.log('RPS._observer.handleMessage; action, id, fields, finalFields, this.selector:', action, id, fields, finalFields, this.selector);

            if (!_.isEmpty(finalFields)) {
                this.callListeners(action, id, finalFields);
                this.docs[id] = newDoc;
            }
        } else if (knownId) {
            //console.log('RPS._observer.handleMessage; removed, id, this.collection._name:', id, this.collection._name);
            // removed
            try {
                this.callListeners('removed', id);
            } catch (e) {
                // already removed, ignore it
            }

            delete this.docs[id];
        }

        if (rightIds) {
            // remove irrelevant docs
            var idMap = _.keys(this.docs);
            _.each(_.difference(idMap, rightIds), function (id) {
                try {
                    this.callListeners('removed', id);
                } catch (e) {
                    // already removed, ignore it
                }
                delete this.docs[id];
            }, this);

            // add new from DB
            _.each(_.difference(rightIds, idMap), function (id) {
                var doc = this.collection.findOne({_id: id}, this.findOptions);
                this.docs[id] = _.extend(doc, this.options.docsMixin);
                this.callListeners('added', id, doc);
            }, this);
        }
    }, this);

    //noPause || this.resume();
};

RPS._observer.prototype.pause = function () {
    //console.log('RPS._observer.pause');
    this.paused = true;
};

RPS._observer.prototype.resume = function () {
    //console.log('RPS._observer.resume → start');
    while (this.messageQueue.length) {
        this.handleMessage(this.messageQueue.shift(), true);
    }
    this.paused = false;
    //console.log('RPS._observer.resume → end');
};

// kill, unsubscribe
RPS._observer.prototype.kill = function () {
    if (!this.initialized) return;
    //console.log('RPS._observer.kill');
    RPS._messenger.removeObserver(this.key);
    delete RPS._observers[this.key];
    this.initialized = false;
    //delete this.docs;
};
