# Redpubsub

Custom pub/sub system that works through channels
(so we avoid that that every oplog change hits every Meteor instance
creating an exponential scaling problem). It use Redis to communicate between Meteor processes.
This works well at https://chatra.io/.

This package implement custom APIs for:
1. Writing data into the database and notifying the pub/sub channel(s) about the change.
2. Data publication mechanism that subscribes to a pub/sub channel instead of using Meteor's oplog tailing.

Most of the performance improvement comes from the fact that we split changes into separate channels, so server publications only need to process changes from channels they are interested in, instead of every single change as is the case in Meteor by default.

### RPS.write(collection, methodName, [options], [callback]) _(anywere)_

### RPS.config[collectionName] = options; _(server)_

### RPS.publish(subscription, [request1, request2...]) _(server)_

### RPS.observeChanges(collection, options, callbacks) _(server)_