# chatra:redpubsub

[![Version](https://img.shields.io/badge/meteor-%203.x-brightgreen?logo=meteor&logoColor=white)](https://github.com/chatr/safe-update)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Custom pub/sub interface for Meteor on top of Redis, updated for Meteor 3 compatibility.

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Installation](#installation)
- [Compatibility](#compatibility)
- [Configuration](#configuration)
- [Usage](#usage)
    - [Server Side](#server-side)
        - [Publishing Data](#publishing-data)
        - [Configuring Channels](#configuring-channels)
        - [Using `RPS.write`](#using-rpswrite-on-the-server)
        - [Publishing with `withoutMongo` Option](#publishing-with-withoutmongo-option)
        - [Publishing Multiple Collections Simultaneously](#publishing-multiple-collections-simultaneously)
        - [Server-Side observeChanges](#server-side-observechanges)
    - [Client Side](#client-side)
        - [Subscribing to Data](#subscribing-to-data)
        - [Using `RPS.write`](#using-rpswrite-on-the-client)
- [Examples](#examples)
- [License](#license)

---

## Introduction

The `chatra:redpubsub` package provides a custom publish/subscribe interface for Meteor applications, leveraging Redis for real-time data synchronization across multiple server instances. This package is especially useful for scaling Meteor applications horizontally, ensuring that all instances remain in sync.

---

## Features

- **Real-Time Data Synchronization:** Uses Redis channels to synchronize data changes across multiple Meteor server instances.
- **Custom Channels:** Configure custom channels for fine-grained control over data publication.
- **Asynchronous Operations:** Fully supports asynchronous MongoDB operations introduced in Meteor 3.
- **No Fibers Dependency**

---

## Installation

```shell
meteor add chatra:redpubsub
```

Ensure that you have Redis installed and running. Set the `RPS_REDIS_URL` environment variable to point to your Redis instance:

```shell
export RPS_REDIS_URL=redis://localhost:6379
```

---

## Compatibility

- **Meteor version 3 and above:** Fully compatible, using the new asynchronous Meteor collections’ methods.

---

## Configuration

### Setting Up Redis Connection

The package uses the `RPS_REDIS_URL` environment variable to connect to your Redis instance. The URL should be in the format:

```
redis://:[password]@[hostname]:[port]
```

Example:

```shell
export RPS_REDIS_URL=redis://localhost:6379
```

### Configuring Channels

You can configure channels on a per-collection basis using `RPS.config`:

```js
// server/main.js
import { RPS } from 'meteor/chatra:redpubsub';

RPS.config['collectionName'] = {
  channels: (doc, selector, fields) => {
    // Return a channel name or an array of channel names
    return `custom_channel_${doc.userId}`;
  },
};
```

---

## Usage

### Server Side

#### Publishing Data

Use `RPS.publish` to publish data to clients:

```js
// server/main.js
import { Meteor } from 'meteor/meteor';
import { RPS } from 'meteor/chatra:redpubsub';
import { CollectionName } from '/imports/api/collectionName';

Meteor.publish('collectionName', function () {
  return RPS.publish(this, {
    collection: CollectionName,
    options: {
      selector: {}, // MongoDB selector
      options: {},  // Find options
    },
  });
});
```

#### Configuring Channels

You can configure custom channels for a collection:

```js
// server/main.js
RPS.config['collectionName'] = {
  channels: (doc) => `channel_${doc.userId}`,
};
```

#### Using `RPS.write` on the Server

Perform write operations and automatically publish changes:

```js
// server/main.js
import { RPS } from 'meteor/chatra:redpubsub';
import { CollectionName } from '/imports/api/collectionName';

async function updateDocument(docId, updateFields) {
  const options = {
    selector: { _id: docId },
    modifier: { $set: updateFields },
    options: {}, // MongoDB update options
  };

  try {
    const result = await RPS.write(CollectionName, 'update', options);
    console.log('Document updated:', result);
  } catch (err) {
    console.error('Error updating document:', err);
  }
}
```

#### Publishing with `withoutMongo` Option

This option allows you to publish changes without querying the database after the write operation.

```js
// server/main.js
import { Meteor } from 'meteor/meteor';
import { RPS } from 'meteor/chatra:redpubsub';
import { MyCollection } from '/imports/api/myCollection';

Meteor.publish('withoutMongoPub', function () {
  return RPS.publish(this, {
    collection: MyCollection,
    options: {
      selector: { active: true },
      withoutMongo: true,  // Disable additional Mongo query after write
    },
  });
});
```

#### Publishing Multiple Collections Simultaneously

You can pass an array of publication requests to `RPS.publish` to publish multiple collections at once:

```js
// server/main.js
import { Meteor } from 'meteor/meteor';
import { RPS } from 'meteor/chatra:redpubsub';
import { CollectionOne } from '/imports/api/collectionOne';
import { CollectionTwo } from '/imports/api/collectionTwo';

Meteor.publish('multiCollections', function () {
  return RPS.publish(this, [
    {
      collection: CollectionOne,
      options: { selector: {} },
    },
    {
      collection: CollectionTwo,
      options: { selector: {} },
    },
  ]);
});
```

#### Server-Side observeChanges

You can directly call `RPS.observeChanges` on the server to perform custom actions when data changes occur:

```js
// server/observe.js
import { RPS } from 'meteor/chatra:redpubsub';
import { CollectionName } from '/imports/api/collectionName';

async function observeServerChanges() {
  const handler = await RPS.observeChanges(
    CollectionName,
    { selector: {} },
    {
      added: (id, fields) => {
        console.log('Document added:', id, fields);
      },
      changed: (id, fields) => {
        console.log('Document changed:', id, fields);
      },
      removed: (id) => {
        console.log('Document removed:', id);
      },
    }
  );

  // To stop observing:
  // handler.stop();
}

observeServerChanges();
```

### Client Side

#### Subscribing to Data

Subscribe to the published data:

```js
// client/main.js
import { Meteor } from 'meteor/meteor';
import { CollectionName } from '/imports/api/collectionName';

Meteor.subscribe('collectionName');
```

#### Using `RPS.write` on the Client

Perform write operations from the client:

```js
// client/main.js
import { RPS } from 'meteor/chatra:redpubsub';
import { CollectionName } from '/imports/api/collectionName';

async function insertDocument(doc) {
  try {
    const result = await RPS.write(CollectionName, 'insert', { doc });
    console.log('Document inserted:', result);
  } catch (err) {
    console.error('Error inserting document:', err);
  }
}
```

---

## Examples

### Full Example

#### Server

```js
// server/main.js
import { Meteor } from 'meteor/meteor';
import { RPS } from 'meteor/chatra:redpubsub';
import { Messages } from '/imports/api/messages';

RPS.config['messages'] = {
  channels: (doc) => `user_${doc.userId}_channel`,
};

Meteor.publish('userMessages', function () {
  const userId = this.userId;
  if (!userId) {
    return this.ready();
  }

  return RPS.publish(this, {
    collection: Messages,
    options: {
      selector: { userId },
    },
  });
});

Meteor.methods({
  async 'messages.insert'(text) {
    const userId = this.userId;
    if (!userId) {
      throw new Meteor.Error('Not authorized');
    }

    const doc = {
      text,
      userId,
      createdAt: new Date(),
    };

    return await RPS.write(Messages, 'insert', { doc });
  },
});
```

#### Client

```js
// client/main.js
import { Meteor } from 'meteor/meteor';
import { Messages } from '/imports/api/messages';

Meteor.subscribe('userMessages');

Messages.find().observeChanges({
  added(id, fields) {
    console.log('Message added:', id, fields);
  },
  changed(id, fields) {
    console.log('Message changed:', id, fields);
  },
  removed(id) {
    console.log('Message removed:', id);
  },
});

async function sendMessage(text) {
  try {
    await Meteor.callAsync('messages.insert', text);
    console.log('Message sent');
  } catch (err) {
    console.error('Error sending message:', err);
  }
}
```

## License

This package is licensed under the MIT License.