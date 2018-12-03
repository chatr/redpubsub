Package.describe({
    name: 'chatra:redpubsub',
    version: '0.10.0',
    summary: 'Custom pub/sub interface for Meteor on top of Redis',
    git: 'https://github.com/chatr/redpubsub.git',
    documentation: 'README.md'
});

Npm.depends({
    redis: '2.8.0',
    url: '0.11.0'
});

Package.onUse(function (api) {
    api.versionsFrom('1.8');

    api.use(['random', 'underscore', 'ejson']);
    api.use(['ddp-server', 'minimongo', 'diff-sequence'], 'server');

    api.addFiles('namespace.js');
    api.addFiles(['utils-server.js', 'redis.js'], 'server');
    api.addFiles(['write.js']);
    api.addFiles('write-client.js', 'client');
    api.addFiles(['write-server.js', 'messenger.js', 'observe-changes.js', 'publish.js'], 'server');

    api.export('RPS');
});
