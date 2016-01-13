/**
 * Match a wildcard rule against and input string.
 *
 *    "a*b"  => everything that starts with "a" and ends with "b"
 "    a*"    => everything that starts with "a"
 "    *b"    => everything that ends with "b"
 "    *a*"   => everything that has a "a" in it
 "    *a*b*" => everything that has a "a" in it, followed by anything, followed by a "b", followed by anything
 * @param str - The full string to be matched against, e.g. my::channel::value
 * @param rule - A string to match with, which can include wildcards, e.g. my::channel::*
 * @returns {boolean}
 * @private
 */
RPS._matchRuleShort = function(str, rule) {
  return new RegExp("^" + rule.replace("*", ".*") + "$").test(str);
};

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
    var channels = Object.keys(RPS._messenger.channels);
    _.each(channels, function (openChannel, idx) {
      //Support wildcard matching for open channels.
      if (RPS._matchRuleShort(channel, openChannel)) {
        _.each(RPS._messenger.channels[openChannel], function (flag, observerKey) {
          var observer = RPS._observers[observerKey];
          if (observer) {
            observer.onMessage(EJSON.clone(message));
          }
        });
      }
    });
  }
};
