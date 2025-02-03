Package.describe({
    name: 'chatra:redpubsub',
    version: '1.0.0',
    summary: 'Custom pub/sub interface for Meteor on top of Redis',
    git: 'https://github.com/chatr/redpubsub.git',
    documentation: 'README.md',
});

Npm.depends({
    redis: '4.7.0',
    'lru-cache': '11.0.2',
});

Package.onUse((api) => {
    api.versionsFrom('3.0');
    api.use(['ecmascript', 'random', 'ejson']);
    api.use(['minimongo', 'diff-sequence'], 'server');

    api.mainModule('main-client.js', 'client');
    api.mainModule('main-server.js', 'server');

    api.export('RPS', ['client', 'server']);
});
