RPS._observers = {};

RPS.observeChanges = function (collection, options, callbacks) {
    options = options || {};

    const listenerId = Random.id();
    const collectionName = collection._name;
    const observerKey = options.observerKey || (JSON.stringify(collectionName) + JSON.stringify(options));

    let observer = RPS._observers[observerKey] || (RPS._observers[observerKey] = new RPS._observer(collection, options, observerKey));

    // initial fetch, if needed or take it from cache (pause incoming messages, while initial add)
    observer.addListener(listenerId, callbacks);

    // return stop method
    // todo: check for memory leak
    return {
        stop: function () {
            observer.removeListener(listenerId);
        },
        docs: observer.docs
    }
};

function topLevelPath (path) {
    if (path.indexOf('.') !== -1) {
        return path.substring(0, path.indexOf('.'));
    } else {
        return path;
    }
}

RPS._observer = function (collection, options, key) {
    const _this = this;

    this.collection = collection;
    this.options = options;
    this.selector = options.selector;
    this.findOptions = options.options || {};
    this.findOptions.fields = this.findOptions.fields || {};
    this.needToFetchAlways = this.findOptions.limit && !options.lazyLimit;
    this.quickFindOptions = _.extend({}, this.findOptions, {fields: {_id: 1}});

    this.projectionFields = _.clone(this.findOptions.fields);
    this.projectionIncluding = null; // Unknown

    if (this.projectionFields) {
        this.projectionTopFields = {};

        _.each(this.projectionFields, function (rule, path) {
            if (path === '_id') return;

            rule = !!rule;

            if (_this.projectionIncluding === null) {
                _this.projectionIncluding = rule;
            }

            if (_this.projectionIncluding !== rule) {
                // This error message is copied from MongoDB shell
                throw MinimongoError('You cannot currently mix including and excluding fields.');
            }

            _this.projectionTopFields[topLevelPath(path)] = rule;
        });

        if (this.options.docsMixin) {
            _.each(this.options.docsMixin, function (value, key) {
                if (_this.projectionIncluding) {
                    _this.projectionFields[key] = 1;
                } else {
                    delete _this.projectionFields[key];
                }
            });
        }
    }

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
    this.actions = {};
    this.docs = {};
    this.lastMethod = {};
    this.lastTs = {};
    this.messageQueue = [];

    // You may not filter out _id when observing changes, because the id is a core
    // part of the observeChanges API
    if (this.findOptions.fields._id === 0 ||
        this.findOptions.fields._id === false) {
        throw Error('You may not observe a cursor with {fields: {_id: 0}}');
    }

    this.initialize();
};

// initialize, subscribe to channel
RPS._observer.prototype.initialize = function () {
    if (this.initialized) return;

    if (!this.options.nonreactive) {
        RPS._messenger.addObserver(this.key, this.channel);
    }

    this.initialized = true;
};

RPS._observer.prototype.addListener = function (listenerId, callbacks) {
    this.listeners[listenerId] = callbacks || {};
    this.refreshActionsList(listenerId);
    this.pause();
    this.initialFetch();
    this.initialAdd(listenerId);
    this.resume();
};

RPS._observer.prototype.callListeners = function (action, id, fields) {
    _.each(this.listeners, function (callbacks, listenerId) {
        callbacks && callbacks[action] && callbacks[action](id, fields);
    });
};

RPS._observer.prototype.removeListener = function (listenerId) {
    delete this.listeners[listenerId];
    if (_.isEmpty(this.listeners)) {
        this.kill();
        this.actions = {};
    } else {
        this.refreshActionsList();
    }
};

RPS._observer.prototype.refreshActionsList = function (listenerId) {
    const _this = this;
    if (listenerId) {
        _.each(this.listeners[listenerId], function (fn, action) {
            _this.actions[action] = 1;
        });
    } else {
        const actions = {};
        _.each(this.listeners, function (callbacks, listenerId) {
            _.each(callbacks, function (fn, action) {
                actions[action] = 1;
            });
        });
        _this.actions = actions;
    }
};

RPS._observer.prototype.initialFetch = function () {
    if (this.initiallyFetched) return;

    if (!this.options.withoutMongo) {
        const _this = this;

        this.collection.find(this.selector, this.findOptions).forEach(function (doc) {
            _this.docs[doc._id] = _this.options.docsMixin ? _.extend(doc, _this.options.docsMixin) : doc;
        });
    }

    this.initiallyFetched = true;
};

RPS._observer.prototype.initialAdd = function (listenerId) {
    const _this = this;
    const callbacks = this.listeners[listenerId];

    _.each(this.docs, function (doc, id) {
        if (!doc) return;
        callbacks.added && callbacks.added(id, _this.projectionFn(doc));
    });
};

RPS._observer.prototype.onMessage = function (message) {
    if (!this.initiallyFetched) return;

    if (message.withoutMongo && this.options.withMongoOnly) {
        return;
    }

    if (this.paused) {
        this.messageQueue.push(message);
    } else {
        this.handleMessage(message);
    }
};

RPS._observer.prototype.handleMessage = function (message) {
    const _this = this;

    function computeModifiedFields () {
        if (!message.modifier || message._modifiedFields) return;

        message._modifiedFields = {};

        _.each(message.modifier, function (params, op) {
            if (op.charAt(0) === '$') {
                _.each(params, function (value, path) {
                    // treat dotted fields as if they are replacing their top-level part
                    // record the field we are trying to change
                    message._modifiedFields[topLevelPath(path)] = true;
                });
            }
        });
    }

    // early decisions
    if (_this.matcher && message.doc) {
        if (!_this.matcher.documentMatches(message.doc).result) {
            // no match with selector

            if (_this.docs[message.id]) {
                // was here before

                _this.callListeners('removed', message.id);
                _this.docs[message.id] = null;

                if (!_this.needToFetchAlways) {
                    // safe to return
                    return;
                }
            } else {
                // supersafe to return
                return;
            }
        } else {
            // matches selector
            if (_this.docs[message.id] && !_this.needToFetchAlways) {
                // doc is already here
                if (!_this.actions.changed) {
                    // but no actions for `changed` are declared (so don’t care)
                    return;
                } else if (_this.projectionIncluding && message.modifier) {
                    computeModifiedFields();

                    const relevantModifier = _.some(message._modifiedFields, function (value, field) {
                        return _this.projectionTopFields[field];
                    });

                    if (!relevantModifier) {
                        return;
                    }
                }
            }
        }
    }

    let fetchedRightIds;
    let ids = (!message.id || _.isArray(message.id)) ? message.id : [message.id];

    if (_this.needToFetchAlways) {
        fetchedRightIds = this.collection.find(this.selector, this.quickFindOptions).map(function (doc) {
            return doc._id;
        });
    }

    if (message.withoutMongo && !ids) {
        try {
            const matcher = new Minimongo.Matcher(message.selector);

            ids = _.pluck(_.filter(this.docs, function (doc) {
                return doc && matcher.documentMatches(doc).result;
            }), '_id');
        } catch (e) {
            // ignore
        }
    }

    if (!ids || !ids.length) return;

    _.each(ids, function (id) {
        // fight against race condition
        const lastTs = _this.lastTs[id];
        const badTS = lastTs >= message.ts;
        const lastMethod = _this.lastMethod[id];

        _this.lastTs[id] = badTS ? lastTs : message.ts;

        if (badTS
            && lastMethod
            && ((message.method !== 'remove' && lastMethod === 'remove') || (message.method === 'remove' && (lastMethod === 'insert' || lastMethod === 'upsert')))) {
            return;
        }

        _this.lastMethod[id] = message.method;

        let oldDoc = _this.docs[id];

        const knownId = !!oldDoc;
        const isRightId = !fetchedRightIds || _.contains(fetchedRightIds, id);

        let newDoc = message.doc;

        if (!newDoc) {
            if (message.method === 'insert' && !badTS) {
                newDoc = _.extend({}, message.selector, {_id: id});
            } else if (message.withoutMongo && message.method !== 'remove') {
                try {
                    if (oldDoc) {
                        const matcher = new Minimongo.Matcher(message.selector);
                        if (!matcher.documentMatches(oldDoc).result) return;
                    }

                    newDoc = _.extend({_id: id}, oldDoc);
                    LocalCollection._modify(newDoc, message.modifier);
                } catch (e) {}
            }
        }

        if (!newDoc && _.isObject(oldDoc) && (message.method === 'update' || message.method === 'upsert') && isRightId && !badTS) {
            try {
                newDoc = EJSON.clone(oldDoc);
                LocalCollection._modify(newDoc, message.modifier);
            } catch (e) {}
        }

        const needToFetch = !newDoc && isRightId && message.method !== 'remove';

        if (needToFetch) {
            newDoc = _this.collection.findOne(_.extend({}, _this.selector, {_id: id}), _this.findOptions);
        }

        const dokIsOk = newDoc
            && isRightId
            && (message.withoutMongo
                || needToFetch
                || (_this.matcher ? (!!message.doc || _this.matcher.documentMatches(newDoc).result) : _this.collection.find(_.extend({}, _this.selector, {_id: id}), _this.quickFindOptions).count()));

        if (message.method !== 'remove' && dokIsOk) {
            if (_this.options.docsMixin) {
                computeModifiedFields();
                _.extend(newDoc, _.omit(_this.options.docsMixin, _.keys(message._modifiedFields || {})));
            }

            // added or changed
            let action;
            let fields;

            if (knownId) {
                action = 'changed';
                fields = DiffSequence.makeChangedFields(newDoc, oldDoc);
            } else {
                action = 'added';
                fields = newDoc;
            }

            const finalFields = _this.projectionFn(fields);

            if (!_.isEmpty(finalFields)) {
                _this.callListeners(action, id, finalFields);
            }

            _this.docs[id] = newDoc;
        } else if (knownId) {
            // removed
            _this.callListeners('removed', id);
            _this.docs[id] = null;
        }

        if (fetchedRightIds) {
            _.each(_this.docs, function (doc, id) {
                // remove irrelevant docs
                if (doc && !_.contains(fetchedRightIds, id)) {
                    _this.callListeners('removed', id);
                    _this.docs[id] = null;
                }
            });

            // add new from DB
            _.each(fetchedRightIds, function (id) {
                if (!_this.docs[id]) {
                    var doc = _this.collection.findOne({_id: id}, _this.findOptions);
                    if (_this.options.docsMixin) {
                        _.extend(doc, _this.options.docsMixin);
                    }
                    _this.callListeners('added', id, _this.projectionFn(doc));
                    _this.docs[id] = doc;
                }
            });
        }
    });
};

RPS._observer.prototype.pause = function () {
    this.paused = true;
};

RPS._observer.prototype.resume = function () {
    while (this.messageQueue.length) {
        this.handleMessage(this.messageQueue.shift(), true);
    }
    this.paused = false;
};

// kill, unsubscribe
RPS._observer.prototype.kill = function () {
    if (!this.initialized) return;
    this.initialized = false;
    this.docs = null;

    if (!this.options.nonreactive) {
        RPS._messenger.removeObserver(this.key);
    }
    delete RPS._observers[this.key];
};
