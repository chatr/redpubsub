RPS._observers = {};

RPS.observeChanges = function (collection, options, callbacks) {
    console.log('RPS.observeChanges');
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
        }
    }
};

RPS._observer = function (collection, options, key) {
    console.log('RPS._observer');

    this.collection = collection;
    this.options = options;
    this.key = key;
    this.channel = options.channel || collection._name;
    this.listeners = {};
    this.docs = {};
    this.messageQueue = [];

    // You may not filter out _id when observing changes, because the id is a core
    // part of the observeChanges API
    if (options.options.fields &&
        (options.options.fields._id === 0 ||
        options.options.fields._id === false)) {
        throw Error("You may not observe a cursor with {fields: {_id: 0}}");
    }

    this.initialize();
};

// initialize, subscribe to channel
RPS._observer.prototype.initialize = function () {
    if (this.initialized) return;
    console.log('RPS._observer.initialize');

    RPS._messenger.addObserver(this.key, this.channel);

    this.initialized = true;
};

RPS._observer.prototype.addListener = function (listenerId, callbacks) {
    if (_.isEmpty(callbacks)) return;
    console.log('RPS._observer.addListener; listenerId:', listenerId);
    this.listeners[listenerId] = callbacks;
    this.pause();
    this.initialFetch();
    this.initialAdd(listenerId);
    this.resume();
};

RPS._observer.prototype.removeListener = function (listenerId) {
    console.log('RPS._observer.removeListener; listenerId:', listenerId);
    delete this.listeners[listenerId];
    if (_.isEmpty(this.listeners)) {
        this.kill();
    }
};

RPS._observer.prototype.initialFetch = function () {
    if (this.initiallyFetched) return;
    console.log('RPS._observer.initialFetch');

    var docs = this.collection.find(this.options.selector, this.options.options).fetch();

    _.each(docs, function (doc) {
        this.docs[doc._id] = doc;
    }, this);

    this.initiallyFetched = true;
};

RPS._observer.prototype.initialAdd = function (listenerId) {
    if (this.initiallyAdded) return;
    console.log('RPS._observer.initialAdd; listenerId:', listenerId);

    var callbacks = this.listeners[listenerId];

    _.each(this.docs, function (doc, id) {
        callbacks.added(id, doc);
    });

    this.initiallyAdded = true;
};

RPS._observer.prototype.onMessage = function (message) {
    if (!this.initiallyFetched) return;
    console.log('RPS._observer.onMessage; message:', message);

    if (this.paused) {
        this.messageQueue.push(message);
    } else {
        this.handleMessage(message);
    }
};

RPS._observer.prototype.handleMessage = function (message) {
    console.log('RPS._observer.handleMessage; message:', message);
};

RPS._observer.prototype.pause = function () {
    console.log('RPS._observer.pause');
    this.paused = true;
};

RPS._observer.prototype.resume = function () {
    console.log('RPS._observer.resume');
    while (this.messageQueue.length) {
        this.handleMessage(this.messageQueue.shift());
    }
    this.paused = false;
};

// kill, unsubscribe
RPS._observer.prototype.kill = function () {
    if (!this.initialized) return;
    console.log('RPS._observer.kill');

    RPS._messenger.removeObserver(this.key);
    delete RPS._observers[this.key];

    this.initialized = false;
};