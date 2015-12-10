Package.describe({
  name: 'artpolikarpov:redpubsub',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Npm.depends({
  'redis': '2.4.2',
  'url': '0.11.0'
});

Package.onUse(function(api) {
  api.versionsFrom('1.2.1');

  api.use(['random', 'underscore', 'ddp-server']);

  api.addFiles('namespace.js');
  api.addFiles('redis.js', 'server');
  api.addFiles('write.js');
  api.addFiles('write-client.js', 'client');
  api.addFiles('write-server.js', 'server');

  api.export('RPS');
});

Package.onTest(function(api) {
  api.use('tinytest');
  api.use('artpolikarpov:redpubsub');
  api.addFiles('redpubsub-tests.js');
});
