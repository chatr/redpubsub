Package.describe({
    name: 'chatra:redpubsub',
    version: '0.14.12',
    summary: 'Custom pub/sub interface for Meteor on top of Redis',
    git: 'https://github.com/chatr/redpubsub.git',
    documentation: 'README.md'
});

Npm.depends({
    redis: '3.1.2',
    url: '0.11.0'
});

Package.onUse(function (api) {
    api.versionsFrom(['METEOR@1.12.1', 'METEOR@2.5']);

    api.use(['random', 'underscore', 'ejson']);
    api.use(['minimongo', 'diff-sequence'], 'server');

    api.addFiles('namespace.js');
    api.addFiles('redis.js', 'server');
    api.addFiles(['write.js']);
    api.addFiles('write-client.js', 'client');
    api.addFiles(['write-server.js', 'messenger.js', 'observe-changes.js', 'publish.js'], 'server');

    api.export('RPS');
});
