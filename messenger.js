const Fiber = Npm.require('fibers');

RPS._messenger = {
    channels: {},
    observers: {},
    addObserver: function (observerKey, channel) {
        if (!RPS._messenger.channels[channel]) {
            RPS._messenger.channels[channel] = {};
        }

        RPS._messenger.channels[channel][observerKey] = true;
        RPS._messenger.observers[observerKey] = channel;

        RPS._sub(channel);
    },
    removeObserver: function (observerKey) {
        const channel = RPS._messenger.observers[observerKey];
        if (channel) {
            delete RPS._messenger.channels[channel][observerKey];
            if (_.isEmpty(RPS._messenger.channels[channel])) {
                RPS._unsub(channel);
                delete RPS._messenger.channels[channel];
            }
        }
        delete RPS._messenger.observers[observerKey];
    },
    onMessage: function (channel, message, runWithFiber) {
        _.each(RPS._messenger.channels[channel], function (flag, observerKey) {
            const observer = RPS._observers[observerKey];
            if (observer) {
                if (runWithFiber) {
                    Fiber(function () {
                        observer.onMessage(message);
                    }).run();
                } else {
                    observer.onMessage(message);
                }
            }
        });
    }
};