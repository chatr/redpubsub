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

    var _this = this;

    this.collection = collection;
    this.options = options;
    this.selector = options.selector;
    this.findOptions = options.options || {};
    this.findOptions.fields = this.findOptions.fields || {};
    this.needToFetchAlways = this.findOptions.limit && !options.lazyLimit;
    this.quickFindOptions = _.extend({}, this.findOptions, {fields: {_id: 1}});

    this.projectionFields = _.clone(this.findOptions.fields);

    if (this.options.docsMixin && this.projectionFields) {
        var including = null; // Unknown

        _.each(this.projectionFields, function (rule, keyPath) {
            if (keyPath === '_id') return;

            rule = !!rule;
            if (including === null) {
                including = rule;
            }
            if (including !== rule) {
                // This error message is copied from MongoDB shell
                throw MinimongoError("You cannot currently mix including and excluding fields.");
            }
        });

        _.each(this.options.docsMixin, function (value, key) {
            if (including) {
                _this.projectionFields[key] = 1;
            } else {
                delete _this.projectionFields[key];
            }
        });
    }

    //console.log('RPS: this.projectionFields:', this.projectionFields);

    this.projectionFn = this.projectionFields ? LocalCollection._compileProjection(this.projectionFields) : function (doc) { return doc };

    try {
        this.matcher = new Minimongo.Matcher(this.selector);
        this.findOptions.fields = this.projectionFields && this.matcher.combineIntoProjection(this.projectionFields);
    } catch (e) {
        // ignore
    }

    this.channel = options.channel || collection._name;
    this.key = key;
    this.listeners = {};
    this.docs = {};
    this.lastMethod = {};
    this.lastTs = {};
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

    if (!this.options.nonreactive) {
        RPS._messenger.addObserver(this.key, this.channel);
    }

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
        callbacks && callbacks[action] && callbacks[action](id, fields);
    });
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
        //console.log('RPS._observer.initialFetch → FETCH');
        var _this = this;

        this.collection.find(this.selector, this.findOptions).forEach(function (doc) {
            //console.log('RPS._observer.initialFetch → FETCH; doc._id:', doc._id);
            _this.docs[doc._id] = _.extend(doc, _this.options.docsMixin);
        });
    }

    this.initiallyFetched = true;
};

RPS._observer.prototype.initialAdd = function (listenerId) {
    //console.log('RPS._observer.initialAdd; listenerId:', listenerId);

    var _this = this;
    var callbacks = this.listeners[listenerId];

    if (callbacks.added) {
        _.each(this.docs, function (doc, id) {
            doc && callbacks.added(id, _this.projectionFn(doc));
        });
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

RPS._observer.prototype.handleMessage = function (message) {
    var _this = this;

    //console.log('RPS._observer.handleMessage; message, this.selector:', message, this.selector);

    // early decisions
    if (!_this.needToFetchAlways && _this.matcher && message.doc && !_this.matcher.documentMatches(message.doc).result) {
        if (_this.docs[message.id]) {
            _this.callListeners('removed', message.id);
            _this.docs[message.id] = null;
        }
        return;
    }

    var rightIds,
        ids = !message.id || _.isArray(message.id) ? message.id : [message.id];

    if (_this.needToFetchAlways) {
        //console.log('RPS._observer.handleMessage → FETCH');
        rightIds = this.collection.find(this.selector, this.quickFindOptions).map(function (doc) {
            return doc._id;
        });
    }

    //console.log('RPS._observer.handleMessage; message.withoutMongo, ids:', message.withoutMongo, ids);
    if (message.withoutMongo && !ids) {
        //console.log('RPS._observer.handleMessage; this.docs, message.selector:', this.docs, message.selector);
        try {
            var matcher = new Minimongo.Matcher(message.selector);
            ids = _.pluck(_.filter(this.docs, function (doc) {
                return doc && matcher.documentMatches(doc).result;
            }), '_id');
        } catch (e) {
            // ignore
        }
        //console.log('RPS._observer.handleMessage → after Minimongo.Matcher; ids:', ids);
    }

    if (!ids || !ids.length) return;

    _.each(ids, function (id) {
        // fight against race condition
        var lastTs = _this.lastTs[id],
            badTS = lastTs >= message.ts,
            lastMethod = _this.lastMethod[id];

        _this.lastTs[id] = badTS ? lastTs : message.ts;
    
        //if (badTS) {
        //    console.warn('RPS: RACE CONDITION! Don’t worry will fix it');
        //}

        if (badTS
            && lastMethod
            && ((message.method !== 'remove' && lastMethod === 'remove') || (message.method === 'remove' && _.contains(['insert', 'upsert'], lastMethod)))) {
            //console.warn('RPS: SKIP MESSAGE! All fine already');
            return;
        }

        _this.lastMethod[id] = message.method;

        var oldDoc = _this.docs[id],
            knownId = !!oldDoc,
            isRightId = !rightIds || _.contains(rightIds, id),
            newDoc = message.doc;

        //console.log('RPS._observer.handleMessage; oldDoc, this.selector:', oldDoc, _this.selector);

        if (!newDoc) {
            if (message.method === 'insert' && !badTS) {
                newDoc = _.extend({}, message.selector, {_id: id});
            } else if (message.withoutMongo && message.method !== 'remove') {
                try {
                    newDoc = _.extend({_id: id}, oldDoc);
                    LocalCollection._modify(newDoc, message.modifier);
                } catch (e) {}
            }
        }

        if (!newDoc && oldDoc && _.contains(['update', 'upsert'], message.method) && isRightId && !badTS) {
            try {
                newDoc = EJSON.clone(oldDoc);
                LocalCollection._modify(newDoc, message.modifier);
            } catch (e) {}
        }

        var needToFetch = !newDoc && isRightId && message.method !== 'remove';

        //console.log('RPS._observer.handleMessage; this.collection._name, badTS, needToFetch:', _this.collection._name, badTS, needToFetch);

        if (needToFetch) {
            //console.log('RPS._observer.handleMessage → FETCH');
            newDoc = _this.collection.findOne(_.extend({}, _this.selector, {_id: id}), _this.findOptions);
        }

        var dokIsOk = newDoc
            && isRightId
            && (message.withoutMongo
                || needToFetch
                || (rightIds && _.contains(rightIds, id))
                || (_this.matcher ? _this.matcher.documentMatches(newDoc).result : _this.collection.find(_.extend({}, _this.selector, {_id: id}), _this.quickFindOptions).count()));

        //console.log('RPS._observer.handleMessage; newDoc, dokIsOk, _.isEqual(newDoc, oldDoc), this.selector:', newDoc, dokIsOk, _.isEqual(newDoc, oldDoc), _this.selector);

        if (message.method !== 'remove' && dokIsOk) {
            if (_this.options.docsMixin) {
                var fieldsFromModifier;

                if (!RPS._containsOperators(message.modifier)) {
                    fieldsFromModifier = _.keys(message.modifier);
                } else if (RPS._containsOnlySetters(message.modifier)) {
                    fieldsFromModifier = _.union(_.keys(message.modifier.$set || {}), _.keys(message.modifier.$unset || {}));
                }
                _.extend(newDoc, _.omit(_this.options.docsMixin, fieldsFromModifier));
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

            var finalFields = _this.projectionFn(fields);
            //console.log('RPS._observer.handleMessage; action, id, fields, finalFields, this.selector:', action, id, fields, finalFields, this.selector);

            if (!_.isEmpty(finalFields)) {
                _this.callListeners(action, id, finalFields);
                _this.docs[id] = newDoc;
            }
        } else if (knownId) {
            //console.log('RPS._observer.handleMessage; removed, id, this.collection._name:', id, this.collection._name);
            // removed
            _this.callListeners('removed', id);
            _this.docs[id] = null;
        }

        if (rightIds) {
            _.each(_this.docs, function (doc, id) {
                // remove irrelevant docs
                if (doc && !_.contains(rightIds, id)) {
                    _this.callListeners('removed', id);
                    _this.docs[id] = null;
                }
            });

            // add new from DB
            _.each(rightIds, function (id) {
                if (!_this.docs[id]) {
                    var doc = _this.collection.findOne({_id: id}, _this.findOptions);
                    _this.callListeners('added', id, _this.projectionFn(doc));
                    _this.docs[id] = _.extend(doc, _this.options.docsMixin);
                }
            });
        }
    });
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
    this.initialized = false;

    if (!this.options.nonreactive) {
        RPS._messenger.removeObserver(this.key);
    }
    delete RPS._observers[this.key];
};