var channels = {},
    observers = {};

RPS._messenger = {
    addObserver: function (observerKey, channel) {
        console.log('RPS._messenger.addObserver; observerKey, channel:', observerKey, channel);
        if (!channels[channel]) {
            console.log('RPS._messenger.addObserver → add channel; channel:', channel);
            channels[channel] = {};
        }

        channels[channel][observerKey] = true;
        observers[observerKey] = channel;

        RPS._sub(channel);
    },
    removeObserver: function (observerKey) {
        console.log('RPS._messenger.removeObserver; observerKey:', observerKey);
        var channel = observers[observerKey];
        if (channel) {
            delete channels[channel][observerKey];
            if (_.isEmpty(channels[channel])) {
                console.log('RPS._messenger.removeObserver → remove channel; channel:', channel);
                RPS._unsub(channel);
                delete channels[channel];
            }
        }
        delete observers[observerKey];
    },
    onMessage: function (channel, message) {
        _.each(channels[channel], function (value, observerKey) {
            var observer = RPS._observers[observerKey];
            if (observer) {
                observer.onMessage(message);
            }
        });
    }
};