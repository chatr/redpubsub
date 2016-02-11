RPS._messenger = {
    channels: {},
    observers: {},
    addObserver: function (observerKey, channel) {
        //console.log('RPS._messenger.addObserver; observerKey, channel:', observerKey, channel);
        if (!RPS._messenger.channels[channel]) {
            //console.log('RPS._messenger.addObserver → add channel; channel:', channel);
            RPS._messenger.channels[channel] = {};
        }

        RPS._messenger.channels[channel][observerKey] = true;
        RPS._messenger.observers[observerKey] = channel;

        RPS._sub(channel);
    },
    removeObserver: function (observerKey) {
        //console.log('RPS._messenger.removeObserver; observerKey:', observerKey);
        var channel = RPS._messenger.observers[observerKey];
        if (channel) {
            delete RPS._messenger.channels[channel][observerKey];
            if (_.isEmpty(RPS._messenger.channels[channel])) {
                //console.log('RPS._messenger.removeObserver → remove channel; channel:', channel);
                RPS._unsub(channel);
                delete RPS._messenger.channels[channel];
            }
        }
        delete RPS._messenger.observers[observerKey];
    },
    onMessage: function (channel, message) {
        //console.log('RPS._messenger.onMessage; channel, message:', channel, message);
        _.each(RPS._messenger.channels[channel], function (flag, observerKey) {
            var observer = RPS._observers[observerKey];
            if (observer) {
                observer.onMessage(EJSON.clone(message));
            }
        });
    }
};

RPS._messenger.onMessageFromRedis = Meteor.bindEnvironment(RPS._messenger.onMessage);