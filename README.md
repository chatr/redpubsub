# Redpubsub

Custom pub/sub system that works through channels
(so we avoid that every oplog change hits every Meteor instance
creating an exponential scaling problem). It use Redis to communicate between Meteor processes.

This package implement custom APIs for:
  1. Writing data into the database and notifying the pub/sub channel(s) about the change.
  2. Data publication mechanism that subscribes to a pub/sub channel instead of using Meteor's oplog tailing.

Most of the performance improvement comes from the fact that we split changes into separate channels, so server publications only need to process changes from channels they are interested in, instead of every single change as is the case in Meteor by default. Also it fetches DB as less as possible, every observer receives `method`, `selector`, and `modifer` and tries to modify docs right in the memory. It does fetch in the case of uncertainty that the operation will be accurate (complicated modifer, race condition, limit, skip, or sort options). Of course redpubsub subscriptions reuse observers with the same options and observers reuse Redis channels.

This all works well at [Chatra](https://chatra.io/). Performance improved to a point where we no longer worry about performance (not any time soon at least). Right now ≈300 active sessions give about 5% CPU usage on a single machine, before this update ≈150 sessions cost us about 75% of CPU.

## Installation

```
meteor add chatra:redpubsub
```

### Redis

This package uses Redis as the communicate channel between nodes. It uses pub/sub functionality of Redis.
So you need to have redis-server running locally during development and `RPS_REDIS_URL` environment variable in production.

If you are new to redis, [read this guide](http://redis.io/topics/quickstart).

## API
### RPS.write(collection, methodName, [options], [callback]) _(anywere)_

Insert a doc synchronously:
```
var newMessageId = RPS.write(Messages, 'insert', {
    doc: {
      message: messageString,
      ts: Date.now(),
      clientId: clientId
    }
});
```

Update asynchronously (callback is passed):
```
RPS.write(Messages, 'update', {
    selector: {_id: messageId},
    modifier: {$set: {message: messageString, updated: true}}
}, function (error, result) {
  if (error) console.warn(error);
});
```

Send ephemeral DB-less typing signal to listeners:
```
RPS.write(Typings, 'upsert', {
    selector: {_id: clientId},
    modifier: {$set: {isTyping: true}},
    withoutMongo: true // do not touch Mongo at all
});
```

### RPS.config[collectionName] = options; _(server)_
Configure what channel(s) to notify via `RPS.config` object:
```
RPS.config.testCollection = {
  channels: ['testCollection', 'anotherStaticChannel']
}
```

Find right channel dinamically:
```
RPS.config.Clients = {
  channels: function (selector) {
    return 'clientById:' + selector._id;
  }
}
```

Note that `selector` in above example is take from `RPS.write` call.

If you need more fields to compute the chanell name you can ask to fetch it from DB via `fetchFields` option and receive in `fields` arguments:
```
RPS.config.Clients = {
  fetchFields: ['hostId'],
  channels: function (selector, fields) {
    return ['clientById:' + fields._id, 'clientsByHostId:' + fields.hostId];
  }
}
```

Note that `fields.hostId` can be a single value or an array of ids if docs that match your `selector` have a different values. So a real config will look like:
```
RPS.config.Transactions = {
    fetchFields: ['hostId'],
    channels: function (selector, fields) {
        var hostId = _.isArray(fields.hostId) ? fields.hostId : [fields.hostId];
        return _.map(hostId, function (hostId) {
            return hostId && ('transactionsByHostId:' + hostId);
        });
    }
};
```

If don’t want to make an extra fetch, pass needed `fields` when calling `RPS.write`:
```
RPS.write(Sessions, 'remove', {
    selector: {_id: session._id},
    fields: {userId: session.userId}
});
```

### RPS.publish(subscription, [request1, request2...]) _(server)_

Use it inside `Meteor.publish`:
```
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
```
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
                channel: 'typingByClientId:' + clientId
            }
        }
    ]);
});
```

### RPS.observeChanges(collection, options, callbacks) _(server)_

It behaves just like Meteor’s `cursor.observeChange`:

```
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

---


