Package.describe({
  name: 'chatra:redpubsub',
  version: '0.2.0',
  // Brief, one-line summary of the package.
  summary: 'Custom pub/sub interface on top of Redis',
  // URL to the Git repository containing the source code for this package.
  git: 'https://github.com/chatr/redpubsub.git',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: null
});

Npm.depends({
  redis: '2.4.2',
  url: '0.11.0'
});

Package.onUse(function(api) {
  api.versionsFrom('1.2.1');

  api.use(['random', 'underscore', 'ddp-server']);
  api.use(['minimongo', 'diff-sequence'], 'server');

  api.addFiles('namespace.js');
  api.addFiles(['utils-server.js', 'redis.js'], 'server');
  api.addFiles(['write.js']);
  api.addFiles('write-client.js', 'client');
  api.addFiles(['write-server.js', 'messenger.js', 'observe-changes.js', 'publish.js'], 'server');

  api.export('RPS');
});

Package.onTest(function(api) {
  api.use('tinytest');
  api.use('chatra:redpubsub');
  api.addFiles('redpubsub-tests.js');
});
