var Fiber = Npm.require('fibers');

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
    onMessage: function (channel, message, runWithFiber) {
        //console.log('RPS._messenger.onMessage; channel, message:', channel, message);
        _.each(RPS._messenger.channels[channel], function (flag, observerKey) {
            var observer = RPS._observers[observerKey];
            if (observer) {
                var messageClone =  EJSON.clone(message);
                if (runWithFiber) {
                    Fiber(function () {
                        observer.onMessage(messageClone);
                    }).run();
                } else {
                    observer.onMessage(messageClone);
                }
            }
        });
    }
};