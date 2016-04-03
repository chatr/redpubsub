# Redpubsub

Custom pub/sub system that works through channels
(so we avoid that that every oplog change hits every Meteor instance
creating an exponential scaling problem). It use Redis to communicate between Meteor processes.

This package implement custom APIs for:
  1. Writing data into the database and notifying the pub/sub channel(s) about the change.
  2. Data publication mechanism that subscribes to a pub/sub channel instead of using Meteor's oplog tailing.

Most of the performance improvement comes from the fact that we split changes into separate channels, so server publications only need to process changes from channels they are interested in, instead of every single change as is the case in Meteor by default. Also it fetches DB as less as possible, every observer receives `method`, `selector`, and `modifer` and tries to modify docs right in the memory. It does fetch in the case of uncertainty that the operation will be accurate (complicated modifer, race condition, limit, skip, or sort options). Of course redpubsub subscriptions reuse observers with the same options and observers reuse Redis channels.

This all works well at [Chatra](https://chatra.io/). Performance improved to a point where we no longer worry about performance (not any time soon at least). Right now ≈300 active sessions give about 5% CPU usage on a single machine, before this implementation ≈150 sessions cost us about 75% of CPU.

## Installation

```bash
meteor add chatra:redpubsub
```

### Redis

This package uses Redis as the communicate channel between nodes. It uses pub/sub functionality of Redis.
So you need to have redis-server running locally during development and `RPS_REDIS_URL` environment variable in production.

If you are new to redis, [read this guide](http://redis.io/topics/quickstart).

## API
### RPS.write(collection, methodName, [options], [callback]) _(server & client simulation)_

Insert a doc synchronously:
```js
var newMessageId = RPS.write(Messages, 'insert', {
    doc: {
      message: messageString,
      ts: Date.now(),
      clientId: clientId
    }
});
```

Update asynchronously (callback is passed):
```js
RPS.write(Messages, 'update', {
    selector: {_id: messageId},
    modifier: {$set: {message: messageString, updated: true}}
}, function (error, result) {
  if (error) console.warn(error);
});
```

Send ephemeral DB-less typing signal to listeners:
```js
RPS.write(Typings, 'upsert', {
    selector: {_id: clientId},
    modifier: {$set: {isTyping: true}},
    withoutMongo: true // do not touch Mongo at all
});
```

Note that if you call `RPS.write` only on the client (outside universal methods for example) channels will be not notified about the change.

### RPS.config[collectionName] = options; _(server)_
Configure what channel(s) to notify via `RPS.config` object:
```js
RPS.config.testCollection = {
  channels: ['testCollection', 'anotherStaticChannel']
}
```

Find right channel dinamically:
```js
RPS.config.Clients = {
  channels: function (doc, selector, fields) {
    return 'clientById:' + doc._id;
  }
}
```

Note that `selector` in above example is take from `RPS.write` call.

To compute the chanell name use `doc`, `selector` or custom `fields` property :
```js
RPS.config.Clients = {
  fetchFields: ['hostId'],
  channels: function (doc, selector, fields) {
    return (doc && doc.hostId && 'clientsByHostId:' + doc.hostId)
      || (fields && fields.hostId && 'clientsByHostId:' + fields.hostId);
  }
}
```

Pass needed `fields` when calling `RPS.write`:
```js
RPS.write(Clients, 'remove', {
    selector: {_id: clientId},
    fields: {hostId: hostId}
});
```

### RPS.publish(subscription, [request1, request2...]) _(server)_

Use it inside `Meteor.publish`:
```js
Meteor.publish('messages', function (clientId) {
    RPS.publish(this, {
        collection: Messages,
        options: {
            selector: {clientId: clientId},
            options: {fields: {secretAdminNote: 0}},
            
            // changes from what channel to listen
            channel: 'messagesByClientId:' + clientId,
        }
    });
});
```

Publish two or more subscriptions:
```js
Meteor.publish('client', function (clientId) {
    RPS.publish(this, [
        {
            collection: Clients,
            options: {
                selector: {_id: clientId},
                channel: 'clientById:' + clientId
            }
        },
        {
            collection: Typings,
            options: {
                selector: {_id: clientId},
                channel: 'typingByClientId:' + clientId,
                withoutMongo: true
            }
        }
    ]);
});
```

### RPS.observeChanges(collection, options, callbacks) _(server)_

It behaves just like Meteor’s `cursor.observeChange`:

```js
var count = 0;
var handler = RPS.observeChanges(Hits, {selector: {siteId: siteId}, options: {fields: {_id: 1}}}, {
    added: function (id, fields) {
      count++;
    },
    removed: function (id) {
      count--;
    }
    // don't care about changed
});

// stop it when you need:
// handler.stop();
```
